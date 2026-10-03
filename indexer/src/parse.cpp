#include "parse.h"
#include <tree_sitter/api.h>
#include <sqlite3.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_set>
#include <vector>
#include "picosha2.h"

namespace fs = std::filesystem;

extern "C" {
const TSLanguage* tree_sitter_tsx(void);
const TSLanguage* tree_sitter_typescript(void);
}

#ifndef QUERIES_DIR
#define QUERIES_DIR "queries"
#endif

// Must match pattern order in queries/tsx.scm.
static const char* KIND_BY_PATTERN[] = {"function", "function", "class", "function"};

static bool run_stmt(sqlite3* db, const char* sql,
                     const std::vector<std::string>& params) {
  sqlite3_stmt* st = nullptr;
  if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK) {
    std::cerr << "prepare failed: " << sqlite3_errmsg(db) << "\n";
    return false;
  }
  for (size_t i = 0; i < params.size(); ++i)
    sqlite3_bind_text(st, (int)i + 1, params[i].c_str(), -1, SQLITE_TRANSIENT);
  int rc = sqlite3_step(st);
  sqlite3_finalize(st);
  return rc == SQLITE_DONE;
}

static std::string read_file(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  if (!in) return "";
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

int index_symbols(const std::string& workspace, const std::string& db_path) {
  const std::string query_src = read_file(fs::path(QUERIES_DIR) / "tsx.scm");
  if (query_src.empty()) {
    std::cerr << "cannot read " << QUERIES_DIR << "/tsx.scm\n";
    return -1;
  }

  sqlite3* db = nullptr;
  if (sqlite3_open(db_path.c_str(), &db) != SQLITE_OK) {
    std::cerr << "cannot open db\n";
    if (db) sqlite3_close(db);
    return -1;
  }

  TSParser* parser = ts_parser_new();
  TSQuery* queries[2] = {nullptr, nullptr};
  const TSLanguage* langs[2] = {tree_sitter_typescript(), tree_sitter_tsx()};
  for (int i = 0; i < 2; ++i) {
    uint32_t err_off = 0;
    TSQueryError err_type = TSQueryErrorNone;
    queries[i] = ts_query_new(langs[i], query_src.c_str(),
                              (uint32_t)query_src.size(), &err_off, &err_type);
    if (!queries[i]) {
      std::cerr << "query compile failed (lang " << i << ") at offset "
                << err_off << " err " << (int)err_type << "\n";
      ts_parser_delete(parser);
      sqlite3_close(db);
      return -1;
    }
  }

  sqlite3_stmt* list = nullptr;
  int symbols = 0;
  if (sqlite3_prepare_v2(db, "SELECT path FROM files;", -1, &list, nullptr) != SQLITE_OK) {
    std::cerr << "cannot list files\n";
    ts_parser_delete(parser);
    sqlite3_close(db);
    return -1;
  }
  while (sqlite3_step(list) == SQLITE_ROW) {
    const std::string rel =
        reinterpret_cast<const char*>(sqlite3_column_text(list, 0));
    const fs::path full = fs::path(workspace) / rel;
    const std::string ext = full.extension().string();
    const int li = (ext == ".tsx") ? 1 : 0;

    const std::string src = read_file(full);
    if (src.empty()) continue;
    ts_parser_set_language(parser, langs[li]);
    TSTree* tree =
        ts_parser_parse_string(parser, nullptr, src.c_str(), (uint32_t)src.size());
    if (!tree) { std::cerr << "parse failed: " << rel << "\n"; continue; }

    std::unordered_set<std::string> seen;  // name::kind per file (collision rule)
    TSQueryCursor* cursor = ts_query_cursor_new();
    ts_query_cursor_exec(cursor, queries[li], ts_tree_root_node(tree));
    TSQueryMatch m;
    while (ts_query_cursor_next_match(cursor, &m)) {
      TSNode def = {0}, name = {0};
      bool has_name = false;
      for (uint32_t i = 0; i < m.capture_count; ++i) {
        uint32_t len = 0;
        const char* cap = ts_query_capture_name_for_id(queries[li], m.captures[i].index, &len);
        std::string cap_name(cap, len);
        if (cap_name == "sym.node") def = m.captures[i].node;
        if (cap_name == "sym.name") { name = m.captures[i].node; has_name = true; }
      }
      if (ts_node_is_null(def) || !has_name || ts_node_is_null(name)) continue;
      if (m.pattern_index >= 4) continue;

      const std::string kind = KIND_BY_PATTERN[m.pattern_index];
      const uint32_t nb = ts_node_start_byte(name), ne = ts_node_end_byte(name);
      if (ne <= nb || ne > src.size()) continue;
      const std::string sym_name = src.substr(nb, ne - nb);

      const std::string start = std::to_string(ts_node_start_point(def).row + 1);
      const std::string end = std::to_string(ts_node_end_point(def).row + 1);
      const uint32_t db_ = ts_node_start_byte(def), de = ts_node_end_byte(def);
      const std::string sym_text =
          (de > db_ && de <= src.size()) ? src.substr(db_, de - db_) : sym_name;

      // Collision rule: first wins the clean id, rest get #<start_line>.
      const std::string key = sym_name + "::" + kind;
      std::string id = rel + "::" + key;
      if (!seen.insert(key).second) id += "#" + start;

      const std::string file_id =
          rel + "::" + full.filename().string() + "::file";
      bool ok = true;
      ok = ok && run_stmt(db,
        "INSERT OR REPLACE INTO nodes(id,type,name,path,start_line,end_line,hash)"
        " VALUES(?1,?2,?3,?4,?5,?6,?7);",
        {id, kind, sym_name, rel, start, end, picosha2::hash256_hex_string(sym_text)});
      ok = ok && run_stmt(db,
        "INSERT OR REPLACE INTO edges(source_id,target_id,type) VALUES(?1,?2,'DEFINES');",
        {file_id, id});
      if (ok) ++symbols;
    }
    ts_query_cursor_delete(cursor);
    ts_tree_delete(tree);
  }
  sqlite3_finalize(list);
  ts_query_delete(queries[0]);
  ts_query_delete(queries[1]);
  ts_parser_delete(parser);
  sqlite3_close(db);
  return symbols;
}
