# Uxie

**A local-first codebase visualizer with an AI debugger.**

Point Uxie at a repo folder (or a git URL) and it turns the code into an interactive graph of files, functions, and classes. Then ask questions like *"What breaks if I change `DatabasePool`?"* and get answers grounded in the actual call graph, not just a guess.

> Built at **StormHacks 2026**.

---

## Why Uxie

Dropping into an unfamiliar codebase means grepping, jumping between files, and building a mental map from scratch. Uxie builds that map for you:

- **See the structure.** Files, symbols, calls, and imports rendered as a navigable graph.
- **Ask in plain English.** Semantic search finds the relevant symbols, and the LLM reasons over them and their neighbors in the graph.
- **Stay local.** Indexing and embeddings run on your machine by default (SQLite + Ollama). Your code doesn't have to leave your laptop.

## How it works

```
 repo folder / git URL
          │
          ▼
┌───────────────────┐     files / nodes / edges
│  Indexer  (C++)   │ ──────────────────────────┐
│  tree-sitter      │                           ▼
└───────────────────┘                  ┌─────────────────┐
                                       │  SQLite (WAL)   │
┌───────────────────┐   vectors        │  files, nodes,  │
│ Embeddings (Py)   │ ───────────────► │  edges,         │
│ Ollama / Voyage / │                  │  embeddings     │
│ OpenAI            │ ◄─────────────── └────────┬────────┘
└───────────────────┘   search_symbols          │
          ▲                                     │
          │                                     ▼
          │                           ┌───────────────────┐   WebSocket   ┌──────────────┐
          └────────────────────────── │  Server (Python)  │ ◄───────────► │  UI (React)  │
                                      │  graph + LLM      │               │  Vite        │
                                      └───────────────────┘               └──────────────┘
```

1. **Index.** The C++ indexer walks the workspace, parses supported files with tree-sitter, and writes `files`, `nodes`, and `edges` into SQLite.
2. **Embed.** The embeddings library embeds each symbol and stores vectors in the same database. Only nodes whose hash changed are re-embedded.
3. **Serve.** The server loads the graph, runs semantic search for a question, pulls in the surrounding call graph, and sends context to the LLM. Everything is streamed to the UI over WebSocket.
4. **Render.** The UI draws the graph and the debugger chat.

## Tech stack

| Layer | Tech |
| --- | --- |
| Indexer | C++17, CMake, tree-sitter |
| Storage | SQLite (WAL mode) |
| Embeddings | Python 3.10+, NumPy, Ollama (`nomic-embed-text`) by default; Voyage and OpenAI supported |
| Server | Python, WebSocket |
| UI | React, Vite |

**Supported languages:** TypeScript, JavaScript (`.ts` `.tsx` `.js` `.jsx`), Python (`.py`), HTML, CSS.

## Quick start

**Prerequisites:** Python 3.10+, Node.js, CMake and a C++17 compiler, git, and [Ollama](https://ollama.com) (for the default embedding backend).

```bash
./setup.sh
```

The script is idempotent and safe to re-run. It checks your tools, builds the indexer, creates `.venv` with all Python dependencies, pulls the embedding model, installs frontend dependencies, and creates `.env` if it's missing.

Then edit `.env` (or keep the defaults for a first run) and run the pipeline:

```bash
# 1. Index a repo
./indexer/build/indexer /path/to/your/repo ./uxie.db

# 2. Embed its symbols
source .venv/bin/activate
python -m embeddings index

# 3. Start the server
cd server && npm run start-server

# 4. Start the UI (http://localhost:5173)
cd ui && npm run dev
```

> If you don't have your own repo handy, use the bundled mock graph. See [Mock data](#mock-data).

## Configuration

Set these in `.env` at the repo root.

| Variable | Description | Default |
| --- | --- | --- |
| `WORKSPACE_PATH` | Path to the repo being analyzed | n/a |
| `DB_PATH` | Path to the SQLite database | n/a |
| `EMBEDDING_PROVIDER` | `ollama`, `voyage`, or `openai` | `ollama` |
| `EMBEDDING_MODEL` | Embedding model name | `nomic-embed-text` |
| `EMBEDDING_API_KEY` | API key (Voyage / OpenAI only) | n/a |
| `OLLAMA_HOST` | Custom Ollama host (optional) | local default |

<!-- TODO: add the LLM provider / API key variables used by the server -->

---

## Components

### Indexer (`indexer/`)

A C++17 CLI that walks a workspace, parses it with tree-sitter, and writes the contract tables with stable `path::name::type` IDs, WAL mode, and 1-indexed line numbers.

- **CALLS** edges are resolved by name matching: same-file match wins, otherwise a unique repo-wide match, otherwise skipped.
- **IMPORTS** edges are file→file (relative imports and Python dotted names).
- **Incremental:** unchanged files (by hash) are skipped, and deleted files are purged.

Build (the first configure downloads the tree-sitter grammars, so it needs network access):

```bash
cmake -B indexer/build -S indexer
cmake --build indexer/build
```

Run:

```bash
./indexer/build/indexer <workspace_path|git_url> <db_path>
./indexer/build/indexer --help   # --db, --full, --clean, --queries, -q/-v
```

Git URLs are shallow-cloned to a temp directory and deleted afterward (private repos work when `git` itself can authenticate). Use `--full` to force a reparse and `--clean` to wipe the DB first.

Exit codes: `0` ok, `1` runtime error, `2` bad usage. Full details are in [`indexer/CHANGES.md`](indexer/CHANGES.md).

### Embeddings (`embeddings/`)

A Python library imported by the server. There's no extra process to run.

```bash
/usr/bin/python3 -m venv .venv   # use system Python, not an editor's `python` shim
source .venv/bin/activate
pip install -r embeddings/requirements.txt
```

Run everything from the **repo root** so `from embeddings import search_symbols` resolves.

```bash
# Embed symbols (only re-embeds nodes whose hash changed)
python -m embeddings index

# Semantic search from the CLI
python -m embeddings search "What breaks if I change DatabasePool?" -k 5
```

Using it from the server (put the repo root on `sys.path` / `PYTHONPATH`):

```python
from embeddings import search_symbols

hits = search_symbols(query, k)  # [{"node_id": str, "score": float}, ...], best first
```

`search_symbols` reads `DB_PATH` and the embedding env vars. It returns `[]` if the embeddings table is empty and raises if the provider is unreachable.

Vectors are stored as raw little-endian float32 BLOBs in `embeddings(node_id, hash, vector)`.

### Server (`server/`)

Serves the graph and the LLM-backed debugger over WebSocket.

```bash
cd server
python3 -m venv venv
source venv/bin/activate        # Windows (cmd): venv\Scripts\activate.bat
                                # Windows (PowerShell): venv\Scripts\Activate.ps1
pip install -r requirements.txt
npm run start-server
```

<!-- TODO: document the WebSocket message types / protocol briefly -->

### UI (`ui/`)

React + Vite, served at `http://localhost:5173`.

<!-- TODO: describe the graph view, node details panel, and debugger chat -->

---

## Data model

All components communicate through one SQLite database.

| Table | Contents |
| --- | --- |
| `files` | Indexed source files and their content hashes |
| `nodes` | Symbols (functions, classes, etc.) with stable `path::name::type` IDs and line ranges |
| `edges` | `CALLS` (symbol→symbol) and `IMPORTS` (file→file) relationships |
| `embeddings` | `(node_id, hash, vector)`, one vector per symbol |

The full schema lives in `CONTRACTS.md`.

## Mock data

Don't have a repo to index? Use the bundled sample graph (7 nodes, 9 edges):

```bash
# Prebuilt at the repo root: sample.db
# Regenerate it:
./indexer/build/indexer indexer/sample-workspace sample.db

# Or seed the embeddings dev DB and workspace:
python -m embeddings seed
python -m embeddings index \
  --db embeddings/dev/sample.db \
  --workspace embeddings/dev/sample_workspace
python -m embeddings search "connection pool" --db embeddings/dev/sample.db
```

## Testing

```bash
python -m unittest embeddings.test_embeddings   # no Ollama required
```

## What's next
 
- Smarter call resolution (scope and type aware)
- More languages (Go, Rust, Java, C/C++)
- Live re-indexing on file changes
- Richer graph filtering and layouts
