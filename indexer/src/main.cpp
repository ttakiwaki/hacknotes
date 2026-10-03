#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <vector>
#include <unistd.h>
#include "db.h"
#include "walker.h"
#include "parse.h"

namespace fs = std::filesystem;

#define INDEXER_VERSION "0.2.0"

// Colors only when stdout is a real terminal (never in pipes) and the
// user hasn't set NO_COLOR. Keeps logs and Ben's subprocess parsing clean.
static bool use_color() {
  if (std::getenv("NO_COLOR")) return false;
  return isatty(STDOUT_FILENO) != 0;
}

struct Pal {
  const char *cyan, *green, *yellow, *red, *dim, *off;
};

static Pal palette() {
  if (!use_color()) return {"", "", "", "", "", ""};
  return {"\033[36m", "\033[32m", "\033[33m", "\033[31m", "\033[2m",
          "\033[0m"};
}

static const char* err_tag() {
  static const bool c =
      isatty(STDERR_FILENO) != 0 && !std::getenv("NO_COLOR");
  return c ? "\033[31merror:\033[0m " : "error: ";
}

static void banner(const Pal& p) {
  std::cout << p.cyan
            << "+-------------------------------+\n"
            << "|  #  hacknotes / indexer       |\n"
            << "+-------------------------------+\n"
            << p.off << p.dim << "  code-graph builder  v" << INDEXER_VERSION
            << "\n\n"
            << p.off;
}

static const char* USAGE =
    "usage: indexer [options] <workspace_path|git_url> <db_path>\n"
    "       indexer [options] <workspace> --db <db_path>\n"
    "\n"
    "Builds a code-graph SQLite db (files/nodes/edges) for a workspace.\n"
    "\n"
    "options:\n"
    "  --db PATH       database file (alternative to 2nd positional arg)\n"
    "  --full          reparse every file, ignoring stored hashes\n"
    "  --clean         delete the db file before indexing\n"
    "  --queries DIR   query (.scm) directory (default: compiled-in QUERIES_DIR)\n"
    "  -q, --quiet     print nothing on success (errors still print)\n"
    "  -v, --verbose   also list each changed file\n"
    "  -h, --help      print this and exit\n"
    "  --version       print the version and exit\n"
    "\n"
    "exit codes: 0 ok, 1 runtime error, 2 bad usage\n";

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

struct Opts {
  std::string workspace, db, queries;
  bool full = false, clean = false, quiet = false, verbose = false;
};

// Returns 0 = ok, 1 = help/version printed (exit 0), 2 = usage error.
static int parse_args(int argc, char** argv, Opts& o, std::string& err) {
  std::vector<std::string> pos;
  auto need_val = [&](int& i, const std::string& flag) -> const char* {
    const std::string a = argv[i];
    const size_t eq = a.find('=');
    if (eq != std::string::npos) return argv[i] + eq + 1;  // --flag=val
    if (i + 1 >= argc) { err = flag + " needs a value"; return nullptr; }
    return argv[++i];
  };
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "-h" || a == "--help") { std::cout << USAGE; return 1; }
    if (a == "--version") { std::cout << "indexer " << INDEXER_VERSION << "\n"; return 1; }
    if (a == "-q" || a == "--quiet") { o.quiet = true; continue; }
    if (a == "-v" || a == "--verbose") { o.verbose = true; continue; }
    if (a == "--full") { o.full = true; continue; }
    if (a == "--clean") { o.clean = true; continue; }
    if (a == "--db" || a.rfind("--db=", 0) == 0) {
      const char* v = need_val(i, "--db");
      if (!v) return 2;
      o.db = v;
      continue;
    }
    if (a == "--queries" || a.rfind("--queries=", 0) == 0) {
      const char* v = need_val(i, "--queries");
      if (!v) return 2;
      o.queries = v;
      continue;
    }
    if (!a.empty() && a[0] == '-') { err = "unknown flag: " + a; return 2; }
    pos.push_back(a);
  }
  if (pos.empty()) { err = "missing <workspace>"; return 2; }
  if (pos.size() > 2) { err = "too many positional args"; return 2; }
  o.workspace = pos[0];
  if (pos.size() == 2) {
    if (!o.db.empty()) { err = "db given twice (--db and positional)"; return 2; }
    o.db = pos[1];
  }
  if (o.db.empty()) { err = "missing <db_path> (or --db)"; return 2; }
  if (o.quiet && o.verbose) { err = "--quiet and --verbose conflict"; return 2; }
  return 0;
}

// Usage: indexer [options] <workspace_path|git_url> <db_path>
int main(int argc, char** argv) {
  Opts o;
  std::string err;
  const int pr = parse_args(argc, argv, o, err);
  if (pr == 1) return 0;
  if (pr == 2) {
    std::cerr << err_tag() << " " << err << "\n" << USAGE;
    return 2;
  }

  const Pal pal = palette();
  if (!o.quiet) banner(pal);

  // GitHub (or any git) URL: shallow-clone to a temp dir and index that.
  // Private repos work when `git` itself can auth (gh CLI / ssh agent).
  std::string tempdir;
  if (is_url(o.workspace)) {
    if (!safe_url(o.workspace)) {
      std::cerr << err_tag() << " refusing unsafe url\n";
      return 1;
    }
    std::error_code ec;
    tempdir = (fs::temp_directory_path(ec) /
               ("hacknotes-index-" + std::to_string(getpid())))
                  .string();
    if (ec) {
      std::cerr << err_tag() << " no temp dir\n";
      return 1;
    }
    const std::string cmd = "git clone --depth 1 --single-branch '" +
                            o.workspace + "' '" + tempdir + "'";
    if (!o.quiet) std::cout << "cloning: " << o.workspace << "\n";
    if (std::system(cmd.c_str()) != 0) {
      std::cerr << err_tag() << " git clone failed\n";
      return 1;
    }
    o.workspace = tempdir;
  }

  if (!o.quiet) {
    std::cout << "workspace: " << o.workspace << "\n";
    std::cout << "db: " << o.db << "\n";
  }
  if (!o.queries.empty()) set_queries_dir(o.queries);

  if (o.clean) {
    std::error_code ec;
    fs::remove(o.db, ec);
    fs::remove(o.db + "-wal", ec);
    fs::remove(o.db + "-shm", ec);
  }

  int rc = 0;
  if (!create_schema(o.db)) {
    std::cerr << err_tag() << " schema creation failed\n";
    rc = 1;
  } else {
    std::vector<std::string> changed;
    int purged = 0;
    int n = index_workspace(o.workspace, o.db, changed, purged, o.full,
                            o.quiet);
    if (n < 0) {
      std::cerr << err_tag() << " walk failed\n";
      rc = 1;
    } else if (n == 0 && !o.full) {
      // No-op rerun, or purge-only (the walker already removed the deleted
      // files' nodes and all edges touching them, so no reparse is needed).
      if (!o.quiet) {
        std::cout << pal.yellow << "up to date" << pal.off << "  ";
        if (purged > 0)
          std::cout << "purged " << purged << " deleted files  ";
        else
          std::cout << "no changes  ";
        std::cout << pal.dim << "-> " << o.db << pal.off << "\n";
      }
    } else {
      int s = index_symbols(o.workspace, o.db, o.quiet);
      if (s < 0) {
        std::cerr << err_tag() << " parse failed\n";
        rc = 1;
      } else {
        if (o.verbose)
          for (const auto& rel : changed) std::cout << "  changed: " << rel << "\n";
        if (!o.quiet)
          std::cout << pal.green << "done" << pal.off << "  " << n
                    << " changed, " << s << " symbols  " << pal.dim << "-> "
                    << o.db << pal.off << "\n";
      }
    }
  }

  if (!tempdir.empty()) {
    std::error_code ec;
    fs::remove_all(tempdir, ec);  // best effort; shallow clone is disposable
  }
  return rc;
}
