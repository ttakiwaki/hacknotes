#include "db.h"
#include <sqlite3.h>
#include <iostream>

static bool exec_sql(sqlite3* db, const char* sql) {
  char* err = nullptr;
  int rc = sqlite3_exec(db, sql, nullptr, nullptr, &err);
  if (rc != SQLITE_OK) {
    std::cerr << "sql error: " << (err ? err : "") << "\n  while: " << sql << "\n";
    sqlite3_free(err);
    return false;
  }
  return true;
}

bool create_schema(const std::string& db_path) {
  sqlite3* db = nullptr;
  if (sqlite3_open(db_path.c_str(), &db) != SQLITE_OK) {
    std::cerr << "cannot open db: " << db_path << "\n";
    if (db) sqlite3_close(db);
    return false;
  }

  bool ok = true;
  ok = ok && exec_sql(db, "PRAGMA journal_mode=WAL;");
  ok = ok && exec_sql(db,
    "CREATE TABLE IF NOT EXISTS files ("
    "  path TEXT PRIMARY KEY,"
    "  hash TEXT NOT NULL"
    ");");
  ok = ok && exec_sql(db,
    "CREATE TABLE IF NOT EXISTS nodes ("
    "  id TEXT PRIMARY KEY,"
    "  type TEXT NOT NULL,"
    "  name TEXT NOT NULL,"
    "  path TEXT NOT NULL,"
    "  start_line INTEGER NOT NULL,"
    "  end_line INTEGER NOT NULL,"
    "  hash TEXT NOT NULL"
    ");");
  ok = ok && exec_sql(db,
    "CREATE TABLE IF NOT EXISTS edges ("
    "  source_id TEXT NOT NULL,"
    "  target_id TEXT NOT NULL,"
    "  type TEXT NOT NULL,"
    "  PRIMARY KEY (source_id, target_id, type)"
    ");");
  ok = ok && exec_sql(db,
    "CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);");
  ok = ok && exec_sql(db,
    "CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);");
  ok = ok && exec_sql(db,
    "CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);");
  ok = ok && exec_sql(db,
    "CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);");

  sqlite3_close(db);
  return ok;
}
