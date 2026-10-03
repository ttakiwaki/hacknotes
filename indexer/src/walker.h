#pragma once
#include <string>
#include <vector>

// Walks the workspace, hashes .ts/.tsx files, and upserts files rows +
// file nodes for CHANGED files only (hash compare against files table).
// Unchanged files are skipped; files deleted from disk are purged with
// their nodes and touching edges. Fills `changed` with the workspace-
// relative paths that were (re)indexed and sets `purged` to the deleted
// file count. Returns changed count, -1 on error.
int index_workspace(const std::string& workspace, const std::string& db_path,
                    std::vector<std::string>& changed, int& purged);
