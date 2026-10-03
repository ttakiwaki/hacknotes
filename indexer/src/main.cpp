#include <iostream>
#include "db.h"
#include "walker.h"

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
  int n = index_workspace(workspace, db_path);
  if (n < 0) {
    std::cerr << "walk failed\n";
    return 1;
  }

  std::cout << "indexed " << n << " ts/tsx files -> " << db_path << "\n";
  return 0;
}
