#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <vector>
#include <unistd.h>
#include "db.h"
#include "walker.h"
#include "parse.h"

namespace fs = std::filesystem;

// A workspace arg is a git URL when it has a URL/SSH scheme.
static bool is_url(const std::string& s) {
  return s.rfind("https://", 0) == 0 || s.rfind("http://", 0) == 0 ||
         s.rfind("git@", 0) == 0 || s.rfind("ssh://", 0) == 0;
}

// The URL is interpolated into a shell command, so only allow characters
// that cannot break out of single quotes or chain commands.
static bool safe_url(const std::string& s) {
  if (s.empty() || s.size() > 512) return false;
  for (char c : s) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9'))
      continue;
    switch (c) {
      case ':': case '/': case '.': case '-': case '_': case '~':
      case '@': case '+': case '%': case '?': case '#': case '=':
        break;
      default:
        return false;
    }
  }
  return true;
}

// Usage: indexer <workspace_path|git_url> <db_path>
int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: indexer <workspace_path|git_url> <db_path>\n";
    return 1;
  }
  std::string workspace = argv[1];
  std::string db_path = argv[2];

  // GitHub (or any git) URL: shallow-clone to a temp dir and index that.
  // Private repos work when `git` itself can auth (gh CLI / ssh agent).
  std::string tempdir;
  if (is_url(workspace)) {
    if (!safe_url(workspace)) {
      std::cerr << "refusing unsafe url\n";
      return 1;
    }
    std::error_code ec;
    tempdir = (fs::temp_directory_path(ec) /
               ("hacknotes-index-" + std::to_string(getpid())))
                  .string();
    if (ec) {
      std::cerr << "no temp dir\n";
      return 1;
    }
    const std::string cmd = "git clone --depth 1 --single-branch '" +
                            workspace + "' '" + tempdir + "'";
    std::cout << "cloning: " << workspace << "\n";
    if (std::system(cmd.c_str()) != 0) {
      std::cerr << "git clone failed\n";
      return 1;
    }
    workspace = tempdir;
  }

  std::cout << "workspace: " << workspace << "\n";
  std::cout << "db: " << db_path << "\n";

  int rc = 0;
  if (!create_schema(db_path)) {
    std::cerr << "schema creation failed\n";
    rc = 1;
  } else {
    std::vector<std::string> changed;
    int purged = 0;
    int n = index_workspace(workspace, db_path, changed, purged);
    if (n < 0) {
      std::cerr << "walk failed\n";
      rc = 1;
    } else if (n == 0) {
      // No-op rerun, or purge-only (the walker already removed the deleted
      // files' nodes and all edges touching them, so no reparse is needed).
      if (purged > 0)
        std::cout << "purged " << purged << " deleted files, db up to date -> "
                  << db_path << "\n";
      else
        std::cout << "no changes, db up to date -> " << db_path << "\n";
    } else {
      int s = index_symbols(workspace, db_path);
      if (s < 0) {
        std::cerr << "parse failed\n";
        rc = 1;
      } else {
        std::cout << "indexed " << n << " changed files, " << s
                  << " symbols -> " << db_path << "\n";
      }
    }
  }

  if (!tempdir.empty()) {
    std::error_code ec;
    fs::remove_all(tempdir, ec);  // best effort; shallow clone is disposable
  }
  return rc;
}
