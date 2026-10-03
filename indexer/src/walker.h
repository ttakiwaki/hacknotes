#pragma once
#include <string>

// Walks the workspace, hashes .ts/.tsx files, and upserts
// files rows + file nodes. Returns file count, or -1 on error.
int index_workspace(const std::string& workspace, const std::string& db_path);
