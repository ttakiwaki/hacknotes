#include "walker.h"
#include <sqlite3.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_set>
#include <vector>
#include "picosha2.h"

namespace fs = std::filesystem;

static const std::unordered_set<std::string> SKIP_DIRS = {
  "node_modules", ".git", "dist"
};

static bool is_target(const fs::path& p) {
  const std::string ext = p.extension().string();
  return ext == ".ts" || ext == ".tsx" || ext == ".js" || ext == ".jsx" ||
         ext == ".py";
}

// Binds every param as text; SQLite coerces numerics into INTEGER columns.
static bool run_stmt(sqlite3* db, const char* sql,
                     const std::vector<std::string>& params) {
  sqlite3_stmt* st = nullptr;
  if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK) {
    std::cerr << "prepare failed: " << sqlite3_errmsg(db) << "\n  " << sql << "\n";
    return false;
  }
  for (size_t i = 0; i < params.size(); ++i)
    sqlite3_bind_text(st, (int)i + 1, params[i].c_str(), -1, SQLITE_TRANSIENT);
  int rc = sqlite3_step(st);
  sqlite3_finalize(st);
  if (rc != SQLITE_DONE) {
    std::cerr << "step failed: " << sqlite3_errmsg(db) << "\n  " << sql << "\n";
    return false;
  }
  return true;
}

static int count_lines(const std::string& data) {
  if (data.empty()) return 0;
  int n = 0;
  for (char c : data) if (c == '\n') ++n;
  if (data.back() != '\n') ++n;
  return n;
}

// Returns the stored hash for path, or "" when the file is not indexed yet.
static std::string stored_hash(sqlite3* db, const std::string& rel) {
  sqlite3_stmt* st = nullptr;
  std::string out;
  if (sqlite3_prepare_v2(db, "SELECT hash FROM files WHERE path=?1;",
                          -1, &st, nullptr) != SQLITE_OK)
    return out;
  sqlite3_bind_text(st, 1, rel.c_str(), -1, SQLITE_TRANSIENT);
  if (sqlite3_step(st) == SQLITE_ROW) {
    const unsigned char* t = sqlite3_column_text(st, 0);
    if (t) out = reinterpret_cast<const char*>(t);
  }
  sqlite3_finalize(st);
  return out;
}

int index_workspace(const std::string& workspace, const std::string& db_path,
                    std::vector<std::string>& changed, int& purged) {
  sqlite3* db = nullptr;
  if (sqlite3_open(db_path.c_str(), &db) != SQLITE_OK) {
    std::cerr << "cannot open db: " << db_path << "\n";
    if (db) sqlite3_close(db);
    return -1;
  }

  const std::string abs_db = fs::absolute(db_path).string();
  std::unordered_set<std::string> seen;
  int skipped = 0;

  std::error_code ec;
  auto it = fs::recursive_directory_iterator(
      workspace, fs::directory_options::skip_permission_denied, ec);
  const auto end = fs::recursive_directory_iterator();
  for (; it != end; it.increment(ec)) {
    if (ec) { std::cerr << "walk error: " << ec.message() << "\n"; ec.clear(); continue; }
    const fs::path& p = it->path();
    if (it->is_directory(ec)) {
      if (SKIP_DIRS.count(p.filename().string())) it.disable_recursion_pending();
      continue;
    }
    if (!it->is_regular_file(ec) || !is_target(p)) continue;
    if (fs::absolute(p).string() == abs_db) continue;  // never index our own db

    std::ifstream in(p, std::ios::binary);
    if (!in) { std::cerr << "cannot read: " << p << "\n"; continue; }
    std::ostringstream ss;
    ss << in.rdbuf();
    const std::string data = ss.str();

    const std::string hex = picosha2::hash256_hex_string(data);
    const std::string rel = fs::relative(p, workspace, ec).generic_string();
    if (ec) { std::cerr << "relative-path error: " << p << "\n"; ec.clear(); continue; }
    seen.insert(rel);

    // Incremental: unchanged hash means nodes/edges are already correct.
    if (stored_hash(db, rel) == hex) { ++skipped; continue; }

    const std::string fname = p.filename().string();
    const std::string id = rel + "::" + fname + "::file";
    const std::string lines = std::to_string(count_lines(data));

    // Reindex: drop this file's old node rows and any edges touching them.
    bool ok = true;
    ok = ok && run_stmt(db,
      "DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE path=?1)"
      " OR target_id IN (SELECT id FROM nodes WHERE path=?1);", {rel});
    ok = ok && run_stmt(db, "DELETE FROM nodes WHERE path=?1;", {rel});
    ok = ok && run_stmt(db,
      "INSERT OR REPLACE INTO files(path,hash) VALUES(?1,?2);", {rel, hex});
    ok = ok && run_stmt(db,
      "INSERT OR REPLACE INTO nodes(id,type,name,path,start_line,end_line,hash)"
      " VALUES(?1,'file',?2,?3,'1',?4,?5);", {id, fname, rel, lines, hex});
    if (!ok) continue;
    changed.push_back(rel);
  }

  // Purge files deleted from disk with their nodes and touching edges.
  purged = 0;
  {
    sqlite3_stmt* list = nullptr;
    if (sqlite3_prepare_v2(db, "SELECT path FROM files;", -1, &list, nullptr) == SQLITE_OK) {
      std::vector<std::string> rows;
      while (sqlite3_step(list) == SQLITE_ROW)
        rows.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(list, 0)));
      sqlite3_finalize(list);
      for (const std::string& rel : rows) {
        if (seen.count(rel)) continue;
        bool ok = true;
        ok = ok && run_stmt(db,
          "DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE path=?1)"
          " OR target_id IN (SELECT id FROM nodes WHERE path=?1);", {rel});
        ok = ok && run_stmt(db, "DELETE FROM nodes WHERE path=?1;", {rel});
        ok = ok && run_stmt(db, "DELETE FROM files WHERE path=?1;", {rel});
        if (ok) ++purged;
      }
    }
  }

  std::cout << "walk: " << changed.size() << " changed, " << skipped
            << " unchanged skipped, " << purged << " deleted purged\n";
  sqlite3_close(db);
  return (int)changed.size();
}
