"""Clone a GitHub repo and index it into the server DB.

Used by the `loadRepository` WebSocket handler. Runs synchronously
(clone + index take seconds); the caller is expected to run this in a
worker thread via `asyncio.to_thread` so the event loop stays responsive.
"""
import os
import re
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEXER_BIN = os.path.join(ROOT, "indexer", "build", "indexer")
REPOS_DIR = os.path.join(ROOT, "repos")

# Only public-style GitHub https URLs. Anything else (ssh, local paths,
# other hosts) is rejected before it can reach git/subprocess.
GITHUB_RE = re.compile(
    r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)


class RepoLoadError(Exception):
    pass


def load_repository(url: str, db_path: str) -> str:
    """Clone `url`, index it into `db_path`. Returns the workspace dir."""
    m = GITHUB_RE.match((url or "").strip())
    if not m:
        raise RepoLoadError(
            "only https://github.com/<owner>/<repo> URLs are supported"
        )
    dest = os.path.join(REPOS_DIR, f"{m.group(1)}_{m.group(2)}")
    if not os.path.isfile(INDEXER_BIN):
        raise RepoLoadError("indexer not built: run ./setup.sh first")

    shutil.rmtree(dest, ignore_errors=True)
    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--single-branch", url, dest],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        raise RepoLoadError(f"git clone failed: {r.stderr.strip()[:200]}")

    r = subprocess.run(
        [INDEXER_BIN, "--clean", "--quiet", dest, db_path],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        out = (r.stderr or r.stdout).strip()[:200]
        raise RepoLoadError(f"indexer failed: {out}")

    return dest
