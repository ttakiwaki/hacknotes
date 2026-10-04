#!/usr/bin/env bash
# One-shot dev setup for hacknotes. Idempotent: safe to re-run.
# Installs nothing system-wide; everything lives in .venv/, frontend/node_modules/, indexer/build/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    cat >&2 <<'EOF'
Windows detected. This setup targets Linux/macOS (the C++ indexer uses
POSIX headers, and the Python/Node steps assume a unix shell).
Easiest path: install WSL2 + Ubuntu, then inside WSL:
  git clone https://github.com/ttakiwaki/hacknotes.git
  cd hacknotes && ./setup.sh
EOF
    exit 1
    ;;
esac

# Package-manager-aware install hint for missing tools.
pkg_hint() {
  local tool="$1" pkgs="$2" brew_pkg="${3:-$2}"
  case "$(uname -s)" in
    Darwin) echo "brew install $brew_pkg" ;;
    Linux)
      if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-} ${ID_LIKE:-}" in
          *fedora*|*rhel*|*centos*) echo "sudo dnf install $pkgs" ;;
          *arch*) echo "sudo pacman -S $pkgs" ;;
          *) echo "sudo apt install $pkgs" ;;
        esac
      else
        echo "sudo apt install $pkgs"
      fi
      ;;
    *) echo "install $tool manually" ;;
  esac
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing '$1' ($2)" >&2
    MISSING=1
  fi
}

echo "== 1/5 checking tools =="
MISSING=0
need cmake "$(pkg_hint cmake cmake cmake)"
need g++ "$(pkg_hint g++ 'g++' gcc)"
need git "$(pkg_hint git git git)"
need sqlite3 "$(pkg_hint sqlite3 sqlite sqlite)"
need python3 "$(pkg_hint python3 'python3 python3-venv' python)"
need node "$(pkg_hint node nodejs nodejs)"
need npm "$(pkg_hint npm npm npm)"
need ollama "install from ollama.com, then: ollama pull nomic-embed-text"
if [ "$MISSING" -ne 0 ]; then
  echo "install the tools above, then re-run ./setup.sh" >&2
  exit 1
fi

echo "== 2/5 building indexer =="
cmake -B indexer/build -S indexer
cmake --build indexer/build

echo "== 3/5 python env =="
if [ ! -x .venv/bin/python ]; then
  /usr/bin/python3 -m venv .venv
fi
.venv/bin/pip install -q -r embeddings/requirements.txt -r server/requirements.txt
.venv/bin/python -c "import fastapi, uvicorn, dotenv, pydantic, numpy, networkx, openai; print('py deps ok')"

echo "== 4/5 embedding model =="
if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
  echo "nomic-embed-text already present"
else
  ollama pull nomic-embed-text
fi

echo "== 5/5 frontend + env =="
if [ -f frontend/package-lock.json ]; then
  npm ci --prefix frontend
else
  npm install --prefix frontend
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example -- edit WORKSPACE_PATH / DB_PATH / keys"
else
  echo ".env exists, leaving it alone"
fi

echo
echo "setup done. Next:"
echo "  1. ./indexer/build/indexer --clean <workspace> ./index.db"
echo "  2. ./.venv/bin/python -m embeddings index     # from repo root"
echo "  3. PYTHONPATH=.:\$PWD/server ./.venv/bin/python server/main.py"
echo "  4. npm --prefix frontend run dev               # UI on :5173"
