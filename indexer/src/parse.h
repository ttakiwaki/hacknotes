#pragma once
#include <string>

// Parses every .ts/.tsx row in files and inserts symbol nodes +
// DEFINES edges (file -> symbol). Returns symbol count, or -1 on error.
int index_symbols(const std::string& workspace, const std::string& db_path);
