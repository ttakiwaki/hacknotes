# hacknotes

Local-first codebase visualizer with an AI debugger. Point it at a repo folder: Josh indexes it into SQLite, Victor embeds symbols, Ben serves graph + LLM over WebSocket, Cameron renders the UI.

## Setup (shared)

```bash
cp .env.example .env
# edit WORKSPACE_PATH (absolute path to the demo repo, e.g. iseo-player)
# edit DB_PATH if you don't want ./index.db
```

Ollama (Victor's default embedding backend) must be installed locally, then:

```bash
ollama pull nomic-embed-text
```

## Victor — embeddings (`embeddings/`)

Python 3.10+, `numpy`. Library imported by Ben's server. No extra process.

```bash
/usr/bin/python3 -m venv .venv   # use system Python, not Cursor's `python` shim
source .venv/bin/activate
pip install -r embeddings/requirements.txt
```

Run from the **repo root** (so `from embeddings import search_symbols` works).

Hour-one mock DB (CONTRACTS.md sample graph) if Josh's indexer DB is not ready:

```bash
python -m embeddings seed
# writes embeddings/dev/sample.db and embeddings/dev/sample_workspace/
```

Index (only re-embeds nodes whose `nodes.hash` changed):

```bash
# against Josh's DB (uses WORKSPACE_PATH and DB_PATH from .env)
python -m embeddings index

# against the mock:
python -m embeddings index \
  --db embeddings/dev/sample.db \
  --workspace embeddings/dev/sample_workspace
```

Search (same model as indexing):

```bash
python -m embeddings search "What breaks if I change DatabasePool?" -k 5
python -m embeddings search "connection pool" --db embeddings/dev/sample.db
```

Ben's import (server should put the repo root on `sys.path` / `PYTHONPATH`):

```python
from embeddings import search_symbols

hits = search_symbols(query, k)  # [{"node_id": str, "score": float}, ...] best first
```

`search_symbols` reads `DB_PATH` and embedding env vars. Returns `[]` if the embeddings table is empty. Raises if the provider is unreachable.

Env: `EMBEDDING_PROVIDER` (`ollama` | `voyage` | `openai`, default `ollama`), `EMBEDDING_MODEL` (default `nomic-embed-text`), `EMBEDDING_API_KEY` (voyage/openai), `DB_PATH`, `WORKSPACE_PATH`, optional `OLLAMA_HOST`.

Vectors: raw little-endian float32 BLOBs in `embeddings(node_id, hash, vector)`. WAL is enabled on connect.

Tests (no Ollama required):

```bash
python -m unittest embeddings.test_embeddings
```

## Josh — indexer (`indexer/`)

C++17 CLI. Walks a workspace (`.ts` / `.tsx` / `.js` / `.jsx` / `.py`),
parses it with tree-sitter, and writes the `files` / `nodes` / `edges`
contract tables (stable `path::name::type` ids, WAL, 1-indexed lines).
CALLS by name matching (same-file wins, else unique repo-wide, else
skipped), IMPORTS file→file (relative + py dotted names), incremental by
file hash (unchanged files skipped, deleted files purged).

Build (first configure downloads the tree-sitter grammars, needs network):

```bash
cmake -B indexer/build -S indexer
cmake --build indexer/build
```

Run:

```bash
./indexer/build/indexer <workspace_path|git_url> <db_path>
./indexer/build/indexer --help   # --db, --full, --clean, --queries, -q/-v
```

Git URLs are shallow-cloned to a temp dir and deleted after (private repos
work when `git` itself can auth). Reruns skip unchanged files; `--full`
forces a reparse, `--clean` wipes the db first. Exit codes: 0 ok, 1 runtime
error, 2 bad usage.

Root `sample.db` is the CONTRACTS.md Section 7 mock graph (7 nodes,
9 edges), regenerable via
`./indexer/build/indexer indexer/sample-workspace sample.db`.
Full docs in `indexer/CHANGES.md`.

## Ben — server (`server/`)

FastAPI on port 8000, WebSocket `ws://localhost:8000/ws` — not wired up yet.

## Cameron — UI (`ui/`)

React + Vite on port 5173 — not wired up yet.

## Status

- Victor: embeddings index + `search_symbols` ready; mock seed for hour one.
- Josh: indexer pipeline complete (walk, parse, CALLS/IMPORTS, incremental, `sample.db`).
- Ben / Cameron: see their sections.
