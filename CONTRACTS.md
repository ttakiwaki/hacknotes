# CONTRACTS.md

**Version:** v0.2 (draft — repository loading message added)

This file defines **exactly what crosses each boundary** between our four pieces. Josh (C++), Victor and Ben (Python) and Cameron (TypeScript) cannot share a types package, so **this file is the shared source of truth**. Everyone builds and mocks against it.

**Rules**
1. If two people disagree on a shape, **this file decides**.
2. **Never change a shape silently.** Edit this file, bump the version, add a row to the Change Log (Section 9), and tell everyone.
3. After any change here, update `README.md` too (and `super.md` if the change affects the stack or ownership).
4. Items tagged **[CONFIRM]** are recommended defaults that the team must explicitly agree on when locking this file. Remove the tag once agreed.

---

## 0. Who talks to whom

```
Josh (C++ indexer) ──SQLite file──► Victor (Python) ──function call──► Ben (Python/FastAPI) ──WebSocket──► Cameron (React)
                    └──────────────SQLite file──────────────────────►  Ben
```

| Boundary | Mechanism | Section |
|---|---|---|
| Josh → Victor, Ben | SQLite file | 1 |
| Victor → Ben | Python function call | 2 |
| Ben ↔ Cameron | WebSocket (JSON) | 3 |
| Ben → Cameron (HTTP, optional) | none planned; everything goes over the WebSocket | — |

---

## 1. SQLite schema (Josh → Victor, Ben)

The database is created and populated by Josh's indexer (`indexer <workspace_path> <db_path>`). Victor adds the `embeddings` table. Ben reads `nodes`, `edges`, `files` (read-only).

```sql
PRAGMA journal_mode = WAL;     -- required, so Josh's binary and Victor/Ben can read/write without lock fights

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,        -- relative to workspace root, forward slashes
  hash TEXT NOT NULL            -- SHA-256 hex of the file contents
);

CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,  -- stable ID, see 1.1
  type       TEXT NOT NULL,     -- 'function' | 'class' | 'file'
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,     -- relative to workspace root, forward slashes
  start_line INTEGER NOT NULL,  -- 1-indexed, inclusive  [CONFIRM]
  end_line   INTEGER NOT NULL,  -- 1-indexed, inclusive  [CONFIRM]
  hash       TEXT NOT NULL      -- SHA-256 hex of the symbol's source text (drives re-embedding)
);

CREATE TABLE IF NOT EXISTS edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type      TEXT NOT NULL,      -- 'CALLS' | 'IMPORTS' | 'INHERITS_FROM' | 'DEFINES'
  PRIMARY KEY (source_id, target_id, type)   -- [CONFIRM] no duplicate edges
);

CREATE INDEX IF NOT EXISTS idx_nodes_path   ON nodes(path);
CREATE INDEX IF NOT EXISTS idx_nodes_name   ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

-- Owned by Victor
CREATE TABLE IF NOT EXISTS embeddings (
  node_id TEXT PRIMARY KEY,     -- nodes.id
  hash    TEXT NOT NULL,        -- copy of nodes.hash at the time of embedding
  vector  BLOB NOT NULL         -- raw float32 little-endian bytes, same dimension for every row  [CONFIRM]
);
```

### 1.1 Node IDs (critical)
- Format: **`path::name::type`**, e.g. `src/db/pool.ts::DatabasePool::class`, `src/api/users.ts::getUser::function`.
- **Stable and deterministic.** Never auto-increment. Reindexing an unchanged symbol must produce the same ID, otherwise Victor's embeddings are orphaned.
- File nodes **[CONFIRM]**: `src/db/pool.ts::pool.ts::file` (name = basename).
- **[OPEN — Josh decides]** Collisions (two same-named functions in one file, overloads, nested functions): deterministic disambiguation, e.g. append `#<start_line>` to the ID only when a collision occurs. Whatever Josh picks must be written here.

### 1.2 Allowed values and semantics

| `nodes.type` | Meaning |
|---|---|
| `function` | Function, method, arrow function / function expression assigned to a variable (includes React components and hooks) |
| `class` | Class definition |
| `file` | A source file. `start_line` = 1, `end_line` = total lines **[CONFIRM]** |

| `edges.type` | Direction (`source → target`) | Typical endpoints **[CONFIRM]** |
|---|---|---|
| `CALLS` | source **calls** target | function → function/class |
| `IMPORTS` | source **imports** target | file → file |
| `INHERITS_FROM` | source **extends** target | class → class |
| `DEFINES` | source **defines** target | file → function/class |

- **Edge direction is always "source depends on / uses target".** "What breaks if I change X?" = nodes with edges **pointing into** X (reverse traversal). This is the rule Ben's BFS and Cameron's highlight-dependents logic must both follow.
- **Both endpoints of every edge must exist in `nodes`** **[CONFIRM]**. Josh drops unresolved edges (calls to external libraries, unmatched names) instead of writing dangling IDs.
- CALLS edges use simple name matching for the MVP; some wrong edges are acceptable.

### 1.3 Reindex behavior
- Josh hashes each file; only new/changed files are reparsed.
- For a changed file, Josh **deletes that file's old `nodes` rows (and edges touching them)** and reinserts. Unchanged files are untouched.
- Victor only re-embeds nodes whose `nodes.hash` differs from `embeddings.hash`, and deletes embeddings whose `node_id` no longer exists.

### 1.4 Workspace-relative paths
- All `path` values are **relative to the workspace root**, **forward slashes**, no leading `./` or `/`. Example: `src/db/pool.ts`.
- To read source text, a consumer joins the workspace root (provided via config, `WORKSPACE_PATH`) with `path` and slices lines `start_line..end_line` inclusive.

---

## 2. `search_symbols` (Victor → Ben)

A plain Python function imported by Ben's server.

```python
def search_symbols(query: str, k: int) -> list[dict]:
    """
    Semantic search over embedded symbols.

    Returns up to k items, sorted by score DESCENDING (best first):
      [{"node_id": "src/db/pool.ts::DatabasePool::class", "score": 0.83}, ...]

    - node_id: an existing nodes.id
    - score:   cosine similarity as float, range 0..1 [CONFIRM] (clamp negatives to 0)
    - Returns [] if the embeddings table is empty. Never raises for "no results".
    - Raises only for real failures (e.g. embedding provider unreachable); Ben catches and reports an `error` message.
    """
```

- Brute-force cosine similarity in numpy (no vector database).
- The query must be embedded with the **same model** used for indexing. If the provider or model changes, the embeddings table must be rebuilt.
- Config via env: `EMBEDDING_PROVIDER` (`ollama` | `voyage` | `openai`, default `ollama`), `EMBEDDING_MODEL` (default `nomic-embed-text`), `DB_PATH`.

---

## 3. WebSocket protocol (Ben ↔ Cameron)

- **Endpoint [CONFIRM]:** `ws://localhost:8000/ws` (FastAPI/uvicorn). UI dev server: `http://localhost:5173` (Vite). Ben enables CORS for `http://localhost:5173`.
- **Transport:** one JSON object per WebSocket text frame. Every message has a string **`type`** field.
- **Naming on the wire [CONFIRM]:** **camelCase** for all JSON keys. Ben uses Pydantic aliases (e.g. `alias_generator=to_camel`, `populate_by_name=True`); Cameron uses matching TypeScript types.
- **Unknown `type`:** receiver ignores it and logs a warning (never crashes).
- **One in-flight question [CONFIRM]:** the UI disables both ask inputs (inspector chat + prompt bar) until `chatDone` (or `error`) arrives, so no request IDs are needed in v0.1. Each input keeps its own thread; streamed tokens route to whichever thread asked.

### 3.1 Message list

| Direction | `type` | Purpose |
|---|---|---|
| Ben → Cameron | `graphData` | Full graph (nodes + edges) |
| Ben → Cameron | `highlightNodes` | IDs of impacted nodes to light up |
| Ben → Cameron | `chatToken` | One streamed chunk of the AI answer |
| Ben → Cameron | `chatDone` | End of the AI answer |
| Ben → Cameron | `nodeSnippet` | Source code of one node (for the drawer) |
| Ben → Cameron | `error` | Something failed; UI shows it instead of hanging **[CONFIRM]** |
| Cameron → Ben | `loadRepository` | User submitted a repository URL |
| Cameron → Ben | `nodeClicked` | User clicked a node |
| Cameron → Ben | `askAI` | User asked a question |

### 3.2 Ben → Cameron

**`graphData`** — sent once right after the socket connects (and again on every reconnect).
```json
{
  "type": "graphData",
  "nodes": [
    {
      "id": "src/db/pool.ts::DatabasePool::class",
      "type": "class",
      "name": "DatabasePool",
      "path": "src/db/pool.ts",
      "startLine": 10,
      "endLine": 84
    },
    {
      "id": "src/api/users.ts::getUser::function",
      "type": "function",
      "name": "getUser",
      "path": "src/api/users.ts",
      "startLine": 5,
      "endLine": 22
    }
  ],
  "edges": [
    {
      "source": "src/api/users.ts::getUser::function",
      "target": "src/db/pool.ts::DatabasePool::class",
      "type": "CALLS"
    }
  ]
}
```
- Node fields: `id`, `type`, `name`, `path`, `startLine`, `endLine` (the DB `hash` is **not** sent).
- Edge fields: `source`, `target`, `type` (DB `source_id`/`target_id` map to `source`/`target`).

**`highlightNodes`** — impacted nodes for the current question.
```json
{ "type": "highlightNodes", "ids": ["src/api/users.ts::getUser::function"] }
```
- `ids` are node IDs that exist in `graphData`. Empty array means "nothing impacted" (UI clears highlights).
- Sent **once per `askAI`**, **before** the first `chatToken` **[CONFIRM]**.

**`chatToken`** — streamed answer chunk.
```json
{ "type": "chatToken", "text": "Changing the pool size affects" }
```
- UI appends `text` **verbatim** (do not trim; spaces and newlines are part of the text). Text is Markdown.

**`chatDone`** — answer finished.
```json
{ "type": "chatDone" }
```

**`nodeSnippet`** — reply to `nodeClicked`.
```json
{
  "type": "nodeSnippet",
  "id": "src/db/pool.ts::DatabasePool::class",
  "code": "export class DatabasePool {\n  // ...\n}"
}
```
- `code` is the raw source text of lines `startLine..endLine` (inclusive) from the file, with original newlines and indentation. The UI infers the highlight language from the node's `path` extension and takes the first line number from the node's `startLine`.

**`error`** **[CONFIRM]**
```json
{ "type": "error", "code": "SYMBOL_NOT_FOUND", "message": "Could not find a symbol matching \"DatabasPool\"." }
```
- `code` is one of: `SYMBOL_NOT_FOUND`, `LLM_ERROR`, `DB_ERROR`, `BAD_REQUEST`, `INTERNAL`.
- `message` is human-readable and safe to show in the UI.
- After an `error` during an `askAI`, Ben does **not** also send `chatDone`; the UI treats `error` as the end of that turn.

### 3.3 Cameron → Ben

**`loadRepository`**
```json
{
  "type": "loadRepository",
  "repositoryUrl": "https://github.com/owner/repository"
}
```
- Sent after the WebSocket connects and again after reconnecting.
- `repositoryUrl` must be non-empty. v0.1 accepts any non-empty string for testing; validation, cloning, and indexing remain backend responsibilities.
- The server refreshes or serves graph data for the selected repository. The current scaffold acknowledges the selection and sends the current `graphData`.

**`askAI`**
```json
{
  "type": "askAI",
  "question": "What breaks if I change DatabasePool?",
  "nodeId": "src/db/pool.ts::DatabasePool::class"
}
```
- `question`: required, non-empty string.
- `nodeId`: **optional**. If present, it is the selected node and Ben uses it as the target directly. If absent, Ben resolves the target from the question text (exact SQLite match first, `search_symbols` as fallback).
- **No resolvable target is not an error:** Ben falls back to general mode — top-k `search_symbols` context (or a project symbol map when search is unavailable), `highlightNodes` with the retrieved IDs (possibly empty), then a streamed general answer.

**`nodeClicked`**
```json
{ "type": "nodeClicked", "id": "src/db/pool.ts::DatabasePool::class" }
```
- Ben responds with `nodeSnippet` for that ID. Highlighting a clicked node's dependents is done **client-side** from the edges in `graphData` (no server round trip).

### 3.4 Sequences

**On connect**
```
UI  ──connect──►  Server
UI  ◄──graphData──  Server
UI  ──loadRepository {repositoryUrl}──► Server
UI  ◄──graphData──  Server
```

**Node click**
```
UI  ──nodeClicked {id}──►  Server
UI  ◄──nodeSnippet {id, code}──  Server
```

**Question**
```
UI  ──askAI {question, nodeId?}──►  Server
UI  ◄──highlightNodes {ids}──  Server
UI  ◄──chatToken {text}──  Server   (repeated)
UI  ◄──chatDone──  Server
```

### 3.5 Edge cases **[CONFIRM]**

| Situation | Behavior |
|---|---|
| Nothing impacted | `highlightNodes` with `"ids": []`, then the answer streams normally |
| Symbol cannot be found (no `nodeId`, no exact or semantic match) | Ben sends `error` with `SYMBOL_NOT_FOUND` |
| `nodeId` not in the database | `error` with `SYMBOL_NOT_FOUND` |
| `nodeClicked` for unknown ID | `error` with `SYMBOL_NOT_FOUND` |
| LLM fails or is rate-limited mid-stream | `error` with `LLM_ERROR`; UI keeps whatever tokens already arrived |
| Malformed JSON or missing required field | `error` with `BAD_REQUEST` |
| Socket drops | UI shows "disconnected", retries with backoff, and a fresh `graphData` arrives on reconnect |
| Large graph | Sent as one `graphData` message (no pagination in v0.1) |

### 3.6 Which nodes get highlighted, and by what

| Highlight | Source |
|---|---|
| **Impacted nodes** (AI answer) | `highlightNodes.ids` from Ben (depth-2 reverse BFS from the target) |
| **Dependents of clicked node** | Computed in the UI from `graphData.edges` (nodes with edges pointing into the clicked node, depth 1 or 2 — Cameron's choice) |
| **Nodes mentioned in the AI text** | **[OPEN]** Computed in the UI by matching node `name`s in the streamed text (no extra message). If this proves unreliable, add a `mentionedNodes` message and record it in the Change Log. |

---

## 4. Conventions (the part people forget)

| Topic | Rule |
|---|---|
| Line numbers | **1-indexed, inclusive** start and end **[CONFIRM]** |
| Paths | Relative to workspace root, forward slashes, never absolute |
| Naming | snake_case in SQLite/Python internals; **camelCase on the wire** **[CONFIRM]**; Ben's Pydantic models are the single translation point |
| Hashes | SHA-256, lowercase hex |
| Encoding | UTF-8 everywhere |
| Timestamps | Not used in v0.1 |
| Ports **[CONFIRM]** | Server `8000`, UI `5173` |

---

## 5. Config / environment variables **[CONFIRM]**

Shared `.env.example` at the repo root (each person copies it to `.env`):

```bash
# Shared
WORKSPACE_PATH=/absolute/path/to/demo-repo        # the repo being visualized (iseo-player)
DB_PATH=./index.db                                # SQLite file written by the indexer

# Victor (embeddings)
EMBEDDING_PROVIDER=ollama                         # ollama | voyage | openai
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=                                # only for voyage/openai

# Ben (LLM, OpenAI-compatible endpoint; provider not final)
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=
LLM_MODEL=                                        # set on the day; do not hardcode in code

# Ben (server)
SERVER_PORT=8000

# Cameron (UI)
VITE_WS_URL=ws://localhost:8000/ws
```

---

## 6. Type definitions (copy these; they must match Sections 1–3)

### 6.1 TypeScript (Cameron) — `ui/src/types/contracts.ts`
```ts
export type NodeType = 'function' | 'class' | 'file';
export type EdgeType = 'CALLS' | 'IMPORTS' | 'INHERITS_FROM' | 'DEFINES';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  path: string;
  startLine: number;
  endLine: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
}

export type ErrorCode =
  | 'SYMBOL_NOT_FOUND'
  | 'LLM_ERROR'
  | 'DB_ERROR'
  | 'BAD_REQUEST'
  | 'INTERNAL';

// Ben -> Cameron
export type ServerMessage =
  | { type: 'graphData'; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'highlightNodes'; ids: string[] }
  | { type: 'chatToken'; text: string }
  | { type: 'chatDone' }
  | { type: 'nodeSnippet'; id: string; code: string }
  | { type: 'error'; code: ErrorCode; message: string };

// Cameron -> Ben
export type ClientMessage =
  | { type: 'loadRepository'; repositoryUrl: string }
  | { type: 'askAI'; question: string; nodeId?: string }
  | { type: 'nodeClicked'; id: string };
```

### 6.2 Pydantic v2 (Ben) — `server/contracts.py`
```python
from typing import Literal, Optional, Union
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class WireModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

NodeType = Literal["function", "class", "file"]
EdgeType = Literal["CALLS", "IMPORTS", "INHERITS_FROM", "DEFINES"]
ErrorCode = Literal["SYMBOL_NOT_FOUND", "LLM_ERROR", "DB_ERROR", "BAD_REQUEST", "INTERNAL"]

class GraphNode(WireModel):
    id: str
    type: NodeType
    name: str
    path: str
    start_line: int
    end_line: int

class GraphEdge(WireModel):
    source: str
    target: str
    type: EdgeType

# Ben -> Cameron (serialize with model_dump(by_alias=True))
class GraphData(WireModel):
    type: Literal["graphData"] = "graphData"
    nodes: list[GraphNode]
    edges: list[GraphEdge]

class HighlightNodes(WireModel):
    type: Literal["highlightNodes"] = "highlightNodes"
    ids: list[str]

class ChatToken(WireModel):
    type: Literal["chatToken"] = "chatToken"
    text: str

class ChatDone(WireModel):
    type: Literal["chatDone"] = "chatDone"

class NodeSnippet(WireModel):
    type: Literal["nodeSnippet"] = "nodeSnippet"
    id: str
    code: str

class ErrorMessage(WireModel):
    type: Literal["error"] = "error"
    code: ErrorCode
    message: str

# Cameron -> Ben
class LoadRepository(WireModel):
    type: Literal["loadRepository"]
    repository_url: str

class AskAI(WireModel):
    type: Literal["askAI"]
    question: str
    node_id: Optional[str] = None

class NodeClicked(WireModel):
    type: Literal["nodeClicked"]
    id: str

ClientMessage = Union[LoadRepository, AskAI, NodeClicked]
```

### 6.3 Victor's return type (Python)
```python
from typing import TypedDict

class SymbolHit(TypedDict):
    node_id: str
    score: float   # cosine, 0..1, sorted descending in the returned list
```

---

## 7. Mock data (everyone builds against this on hour one)

Tiny sample consistent with the contracts. Cameron's `mockGraph.ts`, Ben's test DB, and Victor's fake nodes should all use these IDs.

```json
{
  "nodes": [
    { "id": "src/db/pool.ts::pool.ts::file", "type": "file", "name": "pool.ts", "path": "src/db/pool.ts", "startLine": 1, "endLine": 90 },
    { "id": "src/db/pool.ts::DatabasePool::class", "type": "class", "name": "DatabasePool", "path": "src/db/pool.ts", "startLine": 10, "endLine": 84 },
    { "id": "src/api/users.ts::users.ts::file", "type": "file", "name": "users.ts", "path": "src/api/users.ts", "startLine": 1, "endLine": 40 },
    { "id": "src/api/users.ts::getUser::function", "type": "function", "name": "getUser", "path": "src/api/users.ts", "startLine": 5, "endLine": 22 },
    { "id": "src/api/users.ts::listUsers::function", "type": "function", "name": "listUsers", "path": "src/api/users.ts", "startLine": 24, "endLine": 38 },
    { "id": "src/server.ts::server.ts::file", "type": "file", "name": "server.ts", "path": "src/server.ts", "startLine": 1, "endLine": 30 },
    { "id": "src/server.ts::startServer::function", "type": "function", "name": "startServer", "path": "src/server.ts", "startLine": 8, "endLine": 28 }
  ],
  "edges": [
    { "source": "src/db/pool.ts::pool.ts::file", "target": "src/db/pool.ts::DatabasePool::class", "type": "DEFINES" },
    { "source": "src/api/users.ts::users.ts::file", "target": "src/api/users.ts::getUser::function", "type": "DEFINES" },
    { "source": "src/api/users.ts::users.ts::file", "target": "src/api/users.ts::listUsers::function", "type": "DEFINES" },
    { "source": "src/server.ts::server.ts::file", "target": "src/server.ts::startServer::function", "type": "DEFINES" },
    { "source": "src/api/users.ts::users.ts::file", "target": "src/db/pool.ts::pool.ts::file", "type": "IMPORTS" },
    { "source": "src/server.ts::server.ts::file", "target": "src/api/users.ts::users.ts::file", "type": "IMPORTS" },
    { "source": "src/api/users.ts::getUser::function", "target": "src/db/pool.ts::DatabasePool::class", "type": "CALLS" },
    { "source": "src/api/users.ts::listUsers::function", "target": "src/db/pool.ts::DatabasePool::class", "type": "CALLS" },
    { "source": "src/server.ts::startServer::function", "target": "src/api/users.ts::getUser::function", "type": "CALLS" }
  ]
}
```

Expected result for the question *"What breaks if I change DatabasePool?"* with a depth-2 reverse BFS over this graph:
```json
{ "type": "highlightNodes", "ids": [
  "src/api/users.ts::getUser::function",
  "src/api/users.ts::listUsers::function",
  "src/server.ts::startServer::function"
] }
```
(Depth 1: `getUser`, `listUsers` call the class directly. Depth 2: `startServer` calls `getUser`. Order is not significant. File nodes are reached via `DEFINES`/`IMPORTS` edges only if the team decides to include them; **[CONFIRM]** whether the impact walk follows only `CALLS`/`INHERITS_FROM` edges, as assumed here.)

---

## 8. Open items to settle when locking this file

1. **[OPEN]** Node ID collision rule (Josh).
2. **[OPEN]** Whether the AI-mentioned-node highlight is client-side name matching or a new message (Section 3.6).
3. **[OPEN]** Which edge types the impact walk follows (this file assumes `CALLS` and `INHERITS_FROM` only; `IMPORTS`/`DEFINES` are structural and used for layout/grouping).
4. **[CONFIRM]** Everything tagged `[CONFIRM]`: 1-indexed inclusive lines, camelCase on the wire, float32 vectors, edge primary key and "no dangling edges", ports/endpoint, `error` message shape, one in-flight question, score range 0..1.
5. **[OPEN]** Final LLM provider/model (not a contract, but listed in `.env.example`).

---

## 9. Change log

| Version | Date | Change | Agreed by |
|---|---|---|---|
| v0.1 | 2026-10-02 | Initial draft | (pending team lock) |
| v0.2 | 2026-10-03 | Added Cameron → Ben `loadRepository` WebSocket message carrying `repositoryUrl`; v0.1 accepts any non-empty string for testing and the scaffold re-serves current graph data. | Cameron / Ben pending |
