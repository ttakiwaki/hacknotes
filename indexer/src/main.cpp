#include <iostream>
#include <vector>
#include "db.h"
#include "walker.h"
#include "parse.h"

// Usage: indexer <workspace_path> <db_path>
int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: indexer <workspace_path> <db_path>\n";
    return 1;
  }
  std::string workspace = argv[1];
  std::string db_path = argv[2];

  std::cout << "workspace: " << workspace << "\n";
  std::cout << "db: " << db_path << "\n";

  if (!create_schema(db_path)) {
    std::cerr << "schema creation failed\n";
    return 1;
  }
  std::vector<std::string> changed;
  int purged = 0;
  int n = index_workspace(workspace, db_path, changed, purged);
  if (n < 0) {
    std::cerr << "walk failed\n";
    return 1;
  }

  // No-op rerun: every hash matched, nodes/edges already correct.
  // Purge-only needs no reparse: the walker already removed the deleted
  // files' nodes and all edges touching them.
  if (n == 0) {
    if (purged > 0)
      std::cout << "purged " << purged << " deleted files, db up to date -> "
                << db_path << "\n";
    else
      std::cout << "no changes, db up to date -> " << db_path << "\n";
    return 0;
  }

  int s = index_symbols(workspace, db_path);
  if (s < 0) {
    std::cerr << "parse failed\n";
    return 1;
  }

  std::cout << "indexed " << n << " changed ts/tsx files, " << s << " symbols -> "
            << db_path << "\n";
  return 0;
}
