#include "parse.h"
#include <tree_sitter/api.h>
#include <sqlite3.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include "picosha2.h"

namespace fs = std::filesystem;

extern "C" {
const TSLanguage* tree_sitter_tsx(void);
const TSLanguage* tree_sitter_typescript(void);
const TSLanguage* tree_sitter_javascript(void);
const TSLanguage* tree_sitter_python(void);
const TSLanguage* tree_sitter_html(void);
const TSLanguage* tree_sitter_css(void);
}

#ifndef QUERIES_DIR
#define QUERIES_DIR "queries"
#endif

static std::string g_queries_dir;  // runtime override via set_queries_dir

void set_queries_dir(const std::string& dir) { g_queries_dir = dir; }

static const char* queries_dir() {
  return g_queries_dir.empty() ? QUERIES_DIR : g_queries_dir.c_str();
}

// One entry per supported family. Pattern indices are positions inside that
// family's own query file (tsx.scm and js.scm share the same layout).
struct Lang {
  const TSLanguage* (*fn)();
  const char* query_file;
  const char* kinds[4];  // def kinds by pattern index (only first ndef used)
  int ndef;              // patterns [0, ndef) are DEFINES
  int call_idx;          // CALLS pattern, -1 when absent
  int new_idx;           // constructor-call pattern, -1 when absent
  int imp_start, imp_end;  // IMPORTS patterns [imp_start, imp_end)
  bool python;           // import specs are dotted names, not quoted strings
  const char* imp_keys[2];  // when n_imp_keys > 0, @imp.key text must be one
  int n_imp_keys;           // of these (HTML href/src, CSS url())
};

static const Lang LANG_TS = {tree_sitter_typescript, "tsx.scm",
                             {"function", "function", "class", "function"},
                             4, 4, 5, 6, 8, false, {}, 0};
static const Lang LANG_TSX = {tree_sitter_tsx, "tsx.scm",
                              {"function", "function", "class", "function"},
                              4, 4, 5, 6, 8, false, {}, 0};
static const Lang LANG_JS = {tree_sitter_javascript, "js.scm",
                             {"function", "function", "class", "function"},
                             4, 4, 5, 6, 8, false, {}, 0};
static const Lang LANG_PY = {tree_sitter_python, "py.scm",
                             {"function", "class", "function"},
                             3, 3, -1, 4, 7, true, {}, 0};
// HTML/CSS contribute file nodes + IMPORTS only (no symbol definitions:
// ndef=0, every pattern is an import).
static const Lang LANG_HTML = {tree_sitter_html, "html.scm",
                               {"", "", "", ""},
                               0, -1, -1, 0, 2, false, {"href", "src"}, 2};
static const Lang LANG_CSS = {tree_sitter_css, "css.scm",
                              {"", "", "", ""},
                              0, -1, -1, 0, 2, false, {"url"}, 1};

static const Lang* lang_for(const std::string& ext) {
  if (ext == ".ts") return &LANG_TS;
  if (ext == ".tsx") return &LANG_TSX;
  if (ext == ".js" || ext == ".jsx") return &LANG_JS;
  if (ext == ".py") return &LANG_PY;
  if (ext == ".html") return &LANG_HTML;
  if (ext == ".css") return &LANG_CSS;
  return nullptr;
}

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

static std::string node_text(const std::string& src, TSNode n) {
  const uint32_t b = ts_node_start_byte(n), e = ts_node_end_byte(n);
  if (e <= b || e > src.size()) return "";
  return src.substr(b, e - b);
}

// Resolution rule for a callee name called from file `rel`:
// same-file definition wins, else a unique repo-wide definition, else skip.
static std::string resolve_callee(
    const std::unordered_map<std::string,
                             std::vector<std::pair<std::string, std::string>>>& symmap,
    const std::string& rel, const std::string& callee) {
  auto it = symmap.find(callee);
  if (it == symmap.end()) return "";
  for (const auto& [fr, fid] : it->second)
    if (fr == rel) return fid;
  if (it->second.size() == 1) return it->second[0].second;
  return "";  // ambiguous across files: skip rather than guess
}

// Resolves an import spec from file `rel` to a workspace-relative path
// present in `fileset`. Returns "" when unresolvable (treated as external).
//
// C-family (ts/tsx/js/jsx): spec must be relative ("./util"); tries the
// exact path plus script extensions and index files.
// Python: dotted names; leading dots mean relative (level = number of dots),
// otherwise the dots map to directories under the workspace root. Tries
// <mod>.py and <mod>/__init__.py.
static std::string resolve_import(const std::string& workspace,
                                  const std::unordered_set<std::string>& fileset,
                                  const std::string& rel, const std::string& spec,
                                  bool python) {
  if (spec.empty()) return "";
  std::error_code ec;
  auto try_cands = [&](const fs::path& base, const std::vector<std::string>& suf) {
    for (const auto& s : suf) {
      const fs::path c = s.empty() ? base : fs::path(base.string() + s);
      const std::string r = fs::relative(c, workspace, ec).generic_string();
      if (ec) { ec.clear(); continue; }
      if (r.rfind("..", 0) == 0) continue;
      if (fileset.count(r)) return r;
    }
    return std::string();
  };
  if (python) {
    size_t dots = 0;
    while (dots < spec.size() && spec[dots] == '.') ++dots;
    std::string rest = spec.substr(dots);
    for (char& c : rest)
      if (c == '.') c = '/';
    if (dots > 0) {
      // Relative: level 1 = importing file's dir, each extra dot goes up one.
      fs::path base = (fs::path(workspace) / rel).parent_path();
      for (size_t i = 1; i < dots; ++i) base = base.parent_path();
      base /= rest;
      if (rest.empty()) return try_cands(base, {"/__init__.py"});
      return try_cands(base, {".py", "/__init__.py"});
    }
    if (rest.empty()) return "";
    return try_cands(fs::path(workspace) / rest, {".py", "/__init__.py"});
  }
  if (spec[0] != '.') return "";
  const fs::path base = (fs::path(workspace) / rel).parent_path() / spec;
  const std::string ext = base.extension().string();
  if (ext == ".ts" || ext == ".tsx" || ext == ".js" || ext == ".jsx" ||
      ext == ".html" || ext == ".css") {
    const std::string r = fs::relative(base, workspace, ec).generic_string();
    if (!ec && r.rfind("..", 0) != 0 && fileset.count(r)) return r;
    return "";
  }
  std::string hit = try_cands(base, {".ts", ".tsx", ".js", ".jsx",
                                     ".html", ".css"});
  if (!hit.empty()) return hit;
  return try_cands(base, {"/index.ts", "/index.tsx", "/index.js", "/index.jsx",
                          "/index.html"});
}

int index_symbols(const std::string& workspace, const std::string& db_path,
                  bool quiet) {
  // One compiled query per language (tsx.scm source is shared by .ts/.tsx).
  struct Loaded {
    const Lang* lang;
    TSQuery* query;
  };
  std::vector<Loaded> loaded;
  const Lang* all_langs[6] = {&LANG_TS, &LANG_TSX, &LANG_JS,
                              &LANG_PY, &LANG_HTML, &LANG_CSS};
  std::unordered_map<std::string, std::string> query_text;
  for (const Lang* L : all_langs) {
    if (!query_text.count(L->query_file)) {
      const std::string src = read_file(fs::path(queries_dir()) / L->query_file);
      if (src.empty()) {
        std::cerr << "cannot read " << queries_dir() << "/" << L->query_file << "\n";
        return -1;
      }
      query_text[L->query_file] = src;
    }
    const std::string& src = query_text[L->query_file];
    uint32_t err_off = 0;
    TSQueryError err_type = TSQueryErrorNone;
    TSQuery* q = ts_query_new(L->fn(), src.c_str(), (uint32_t)src.size(),
                              &err_off, &err_type);
    if (!q) {
      std::cerr << "query compile failed (" << L->query_file << ") at offset "
                << err_off << " err " << (int)err_type << "\n";
      for (const auto& ld : loaded) ts_query_delete(ld.query);
      return -1;
    }
    loaded.push_back({L, q});
  }

  sqlite3* db = nullptr;
  if (sqlite3_open(db_path.c_str(), &db) != SQLITE_OK) {
    std::cerr << "cannot open db\n";
    if (db) sqlite3_close(db);
    return -1;
  }

  TSParser* parser = ts_parser_new();

  std::vector<std::string> rels;
  {
    sqlite3_stmt* list = nullptr;
    if (sqlite3_prepare_v2(db, "SELECT path FROM files;", -1, &list, nullptr) != SQLITE_OK) {
      std::cerr << "cannot list files\n";
      for (const auto& ld : loaded) ts_query_delete(ld.query);
      ts_parser_delete(parser);
      sqlite3_close(db);
      return -1;
    }
    while (sqlite3_step(list) == SQLITE_ROW)
      rels.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(list, 0)));
    sqlite3_finalize(list);
  }

  auto loaded_for = [&](const fs::path& p) -> const Loaded* {
    const Lang* L = lang_for(p.extension().string());
    if (!L) return nullptr;
    for (const auto& ld : loaded)
      if (ld.lang == L) return &ld;
    return nullptr;
  };

  // Pass 1: symbol nodes + DEFINES. Builds lookup maps for pass 2.
  std::unordered_map<std::string,
                     std::vector<std::pair<std::string, std::string>>> symmap;  // name -> (rel, id)
  std::unordered_map<std::string, std::string> defmap;  // rel:start_byte -> symbol id
  const std::unordered_set<std::string> fileset(rels.begin(), rels.end());
  int symbols = 0;
  for (const std::string& rel : rels) {
    const fs::path full = fs::path(workspace) / rel;
    const Loaded* ld = loaded_for(full);
    if (!ld) continue;
    const std::string src = read_file(full);
    if (src.empty()) continue;
    ts_parser_set_language(parser, ld->lang->fn());
    TSTree* tree =
        ts_parser_parse_string(parser, nullptr, src.c_str(), (uint32_t)src.size());
    if (!tree) { std::cerr << "parse failed: " << rel << "\n"; continue; }

    std::unordered_set<std::string> seen;  // name::kind per file (collision rule)
    TSQueryCursor* cursor = ts_query_cursor_new();
    ts_query_cursor_exec(cursor, ld->query, ts_tree_root_node(tree));
    TSQueryMatch m;
    while (ts_query_cursor_next_match(cursor, &m)) {
      if ((int)m.pattern_index >= ld->lang->ndef) continue;  // calls in pass 2
      TSNode def = {0}, name = {0};
      bool has_name = false;
      for (uint32_t i = 0; i < m.capture_count; ++i) {
        uint32_t len = 0;
        const char* cap = ts_query_capture_name_for_id(ld->query, m.captures[i].index, &len);
        std::string cap_name(cap, len);
        if (cap_name == "sym.node") def = m.captures[i].node;
        if (cap_name == "sym.name") { name = m.captures[i].node; has_name = true; }
      }
      if (ts_node_is_null(def) || !has_name || ts_node_is_null(name)) continue;

      const std::string kind = ld->lang->kinds[m.pattern_index];
      const std::string sym_name = node_text(src, name);
      if (sym_name.empty()) continue;
      const std::string start = std::to_string(ts_node_start_point(def).row + 1);
      const std::string end = std::to_string(ts_node_end_point(def).row + 1);
      const std::string sym_text = node_text(src, def);
      const std::string text = sym_text.empty() ? sym_name : sym_text;

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
        {id, kind, sym_name, rel, start, end, picosha2::hash256_hex_string(text)});
      ok = ok && run_stmt(db,
        "INSERT OR REPLACE INTO edges(source_id,target_id,type) VALUES(?1,?2,'DEFINES');",
        {file_id, id});
      if (!ok) continue;
      ++symbols;
      symmap[sym_name].emplace_back(rel, id);
      defmap[rel + ":" + std::to_string(ts_node_start_byte(def))] = id;
    }
    ts_query_cursor_delete(cursor);
    ts_tree_delete(tree);
  }

  // Pass 2: CALLS edges (caller function -> callee symbol).
  int calls = 0, skipped_ambiguous = 0, skipped_external = 0;
  int imports = 0;
  for (const std::string& rel : rels) {
    const fs::path full = fs::path(workspace) / rel;
    const Loaded* ld = loaded_for(full);
    if (!ld) continue;
    const std::string src = read_file(full);
    if (src.empty()) continue;
    ts_parser_set_language(parser, ld->lang->fn());
    TSTree* tree =
        ts_parser_parse_string(parser, nullptr, src.c_str(), (uint32_t)src.size());
    if (!tree) continue;

    TSQueryCursor* cursor = ts_query_cursor_new();
    ts_query_cursor_exec(cursor, ld->query, ts_tree_root_node(tree));
    TSQueryMatch m;
    while (ts_query_cursor_next_match(cursor, &m)) {
      if ((int)m.pattern_index < ld->lang->ndef) continue;
      if ((int)m.pattern_index >= ld->lang->imp_start) {
        // IMPORTS: file -> file, resolved against the files table.
        TSNode path = {0}, key = {0};
        bool has_path = false, has_key = false;
        for (uint32_t i = 0; i < m.capture_count; ++i) {
          uint32_t len = 0;
          const char* cap = ts_query_capture_name_for_id(ld->query, m.captures[i].index, &len);
          const std::string cn(cap, len);
          if (cn == "imp.path") { path = m.captures[i].node; has_path = true; }
          if (cn == "imp.key") { key = m.captures[i].node; has_key = true; }
        }
        if (ts_node_is_null(path) || !has_path) continue;
        // Gated imports: when the pattern captured a key (HTML href/src,
        // CSS url()), it must be an allowed one. Patterns without a key
        // (CSS bare strings, all C-family imports) pass through.
        if (has_key && !ts_node_is_null(key)) {
          const std::string ktext = node_text(src, key);
          bool allowed = false;
          for (int ki = 0; ki < ld->lang->n_imp_keys; ++ki)
            if (ktext == ld->lang->imp_keys[ki]) { allowed = true; break; }
          if (!allowed) continue;
        }
        std::string spec = node_text(src, path);
        // Strip matching quotes (CSS strings carry them; HTML attribute
        // values and Python dotted names never do).
        if (!ld->lang->python && spec.size() >= 2 &&
            ((spec.front() == '"' && spec.back() == '"') ||
             (spec.front() == '\'' && spec.back() == '\'')))
          spec = spec.substr(1, spec.size() - 2);
        const std::string tres =
            resolve_import(workspace, fileset, rel, spec, ld->lang->python);
        if (tres.empty()) { ++skipped_external; continue; }
        const std::string src_id =
            rel + "::" + full.filename().string() + "::file";
        const std::string dst_id =
            tres + "::" + fs::path(tres).filename().string() + "::file";
        if (run_stmt(db,
              "INSERT OR REPLACE INTO edges(source_id,target_id,type)"
              " VALUES(?1,?2,'IMPORTS');",
              {src_id, dst_id}))
          ++imports;
        continue;
      }
      TSNode node = {0}, name = {0};
      bool has_name = false;
      for (uint32_t i = 0; i < m.capture_count; ++i) {
        uint32_t len = 0;
        const char* cap = ts_query_capture_name_for_id(ld->query, m.captures[i].index, &len);
        std::string cap_name(cap, len);
        if (cap_name == "call.node") node = m.captures[i].node;
        if (cap_name == "call.name") { name = m.captures[i].node; has_name = true; }
      }
      if (ts_node_is_null(node) || !has_name || ts_node_is_null(name)) continue;
      const std::string callee = node_text(src, name);
      if (callee.empty()) continue;

      // Caller = nearest enclosing symbol (walk up to a pass-1 def node;
      // the loop ends at the file root: `program` in TS/JS, `module` in py).
      std::string caller;
      TSNode cur = node;
      while (!ts_node_is_null(cur = ts_node_parent(cur))) {
        auto it = defmap.find(rel + ":" + std::to_string(ts_node_start_byte(cur)));
        if (it != defmap.end()) { caller = it->second; break; }
      }
      if (caller.empty()) continue;  // top-level call: no function caller

      const std::string target = resolve_callee(symmap, rel, callee);
      if (target.empty()) {
        if (symmap.find(callee) == symmap.end()) ++skipped_external;
        else ++skipped_ambiguous;
        continue;
      }
      if (run_stmt(db,
            "INSERT OR REPLACE INTO edges(source_id,target_id,type)"
            " VALUES(?1,?2,'CALLS');",
            {caller, target}))
        ++calls;
    }
    ts_query_cursor_delete(cursor);
    ts_tree_delete(tree);
  }

  for (const auto& ld : loaded) ts_query_delete(ld.query);
  ts_parser_delete(parser);
  sqlite3_close(db);
  if (!quiet)
    std::cout << "calls: " << calls << " (ambiguous skipped: " << skipped_ambiguous
              << ", external/dangling skipped: " << skipped_external << ")\n"
              << "imports: " << imports << "\n";
  return symbols;
}
