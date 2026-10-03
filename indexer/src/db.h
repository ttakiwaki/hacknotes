#pragma once
#include <string>

// Creates files/nodes/edges tables (IF NOT EXISTS) and enables WAL.
// Returns true on success.
bool create_schema(const std::string& db_path);

// Inserts one hardcoded file + function node + DEFINES edge so
// Ben/Cameron can demo before real parsing lands.
bool insert_dummy_rows(const std::string& db_path);
