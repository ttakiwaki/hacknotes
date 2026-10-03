#include <iostream>
#include "db.h"

// Usage: indexer <workspace_path> <db_path>
// MVP0: ignores workspace contents, just creates schema + dummy rows.
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
  if (!insert_dummy_rows(db_path)) {
    std::cerr << "dummy insert failed\n";
    return 1;
  }

  std::cout << "MVP0 db ready (schema + 1 dummy function)\n";
  return 0;
}
