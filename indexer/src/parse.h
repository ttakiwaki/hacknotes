#pragma once
#include <string>

// Parses every .ts/.tsx row in files and inserts symbol nodes +
// DEFINES edges (file -> symbol). `quiet` suppresses the run summary.
// Returns symbol count, or -1 on error.
int index_symbols(const std::string& workspace, const std::string& db_path,
                  bool quiet = false);

// Overrides the compiled-in query directory (default QUERIES_DIR).
void set_queries_dir(const std::string& dir);
