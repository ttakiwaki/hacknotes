#pragma once
#include <string>

// Creates files/nodes/edges tables (IF NOT EXISTS) and enables WAL.
// Returns true on success.
bool create_schema(const std::string& db_path);
