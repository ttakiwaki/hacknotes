# SUPER.md — Hackathon Project Context (read this fully before answering anything)

> **For the AI reading this:** This file is the single source of truth for our hackathon project. The person who dropped it into the chat is one of four teammates (see "Team & ownership"). Unless they tell you otherwise, assume the user is **Cameron (front-end)**. Read the whole file, then answer questions in the context of this plan. Do not ask for information that is already here. If something is marked **[OPEN]** or **[PROPOSED]**, treat it as not finalized: use the stated default, say you are using it, and flag it if it matters to the answer.

---

## 0. Ground rules for the AI (important)

1. **The stack is locked.** Do not suggest swapping languages, frameworks, or architecture (e.g. "use a VS Code extension", "use LanceDB", "rewrite the indexer in TypeScript", "use Cytoscape") unless the user explicitly asks to reconsider or the stated fallback conditions in Section 11 are met. Small additions (a helper library, a utility) are fine; replacing a core piece is not.
2. **Stay in the user's lane.** Help with the piece the user owns. If a change would alter a boundary between teammates (SQLite schema, `search_symbols`, WebSocket messages), say so explicitly and tell the user it must be agreed with the team and written into `CONTRACTS.md` first. Never silently change a contract shape.
3. **Hackathon priorities:** working end-to-end demo > correctness > polish > extra features. Prefer simple, fast-to-build solutions. Avoid over-engineering, avoid premature abstractions.
4. **Everything is local-first and runs on a laptop.** No cloud infrastructure, no hosted databases, no Docker requirement. Only the LLM (and optionally embeddings) may call an external API.
5. **If unsure, ask one concise question** rather than guessing about anything that touches a contract.
6. **Match the language/conventions of the person's piece** (see Section 7). Give complete, copy-pasteable code when asked for code.
7. If this file conflicts with something said earlier in the chat by the user, the user's latest explicit statement wins; mention that this file may need updating.
8. **Log every change, big or small, in `CHANGES.md` (repo root).** Whenever your response creates, edits, deletes, renames, refactors, or fixes anything (code, config, docs, contracts, even a one-line typo or a variable rename), end the response with a **ready-to-paste `CHANGES.md` entry** in this format (one table row per change set):

   `| Date | Who / branch | Area | What changed | Why | Files touched | Contract impact |`

   - `Area` is one of: `indexer`, `embeddings`, `server`, `ui`, `contracts`, `docs`, `config`, `other`.
   - `Contract impact` is `none`, or names which contract changed (SQLite schema / `search_symbols` / WebSocket / conventions). A contract change also requires an edit to `CONTRACTS.md` and a row in its own change log.
   - **One entry per change set**, written in the same response as the change, never "later". **Nothing is too small to log.** If in doubt, log it.
   - **Append-only.** New entries go at the bottom of the table; never rewrite, reorder or delete old entries (if an earlier entry was wrong, add a new correcting entry).
   - Pure questions, explanations and brainstorming with no change to any file need no entry.
   - Do not invent dates, branch names or author names: use what the user told you in this chat, or leave the field as `?` and ask.
   - `CHANGES.md` is the only change log. `README.md` is a separate, hand-maintained run guide and is **not** part of this rule; do not say "README unaffected" or add README columns to log entries.

---

## 1. The project in one paragraph

A **local-first codebase visualizer with an AI debugger**. You point it at a repo folder. It parses the code, builds a **graph of functions, classes and files** (who calls what, who imports what), shows it as an **interactive diagram** in a browser tab, and lets you ask questions like *"What breaks if I change DatabasePool?"*. The AI answers using the graph (structural neighbors) plus semantic code search (embeddings), and the **affected nodes light up in the UI** while the explanation streams into a chat panel.

- **Event:** Hackathon starting **2026-10-03** (tomorrow relative to when this file was written, 2026-10-02). Hackathon name, duration, and judging criteria: **[OPEN — not provided]**.
- **Form factor:** a **standalone local app** (local Python server + React app in a browser tab). It is **NOT a VS Code extension** (decided: extensions add packaging/webview headaches, and Ben is on Python so an extension host is not possible anyway).
- **Demo repo (what we point the tool at):** `https://github.com/ttakiwaki/iseo-player` — a web music player built with **React + TypeScript**. Because it is a React/TS repo, the indexer needs to handle `.ts` **and `.tsx`** files (see Josh's notes).

---

## 2. Source-of-truth and superseded decisions

Two planning documents existed. **The newer plan (this file) is authoritative.** The older plan is superseded; do not reintroduce its choices:

| Topic | Old plan (SUPERSEDED, ignore) | Current plan (USE THIS) |
|---|---|---|
| Form factor | VS Code extension + webview | Standalone local app, browser tab |
| Indexer | TypeScript with tree-sitter / web-tree-sitter in Node | **C++17 CLI binary** (Josh) |
| Graph traversal | Graphology (TypeScript) | **NetworkX** (Python, Ben) |
| Vector store | LanceDB | **SQLite `embeddings` table + numpy brute-force cosine** (Victor) |
| Messaging | `vscode.postMessage` | **WebSocket** (Ben ↔ Cameron) |
| Server | Extension host (Node) | **FastAPI (Python)** |
| UI | React + Vite + React Flow/Cytoscape | **React + Vite + React Flow** (Cytoscape only as fallback) |

---

## 3. Team & ownership

The pipeline is a chain. **Each person owns one transform and each output is the next person's input.**

| Person | Owns | Language | Runs as |
|---|---|---|---|
| **Josh** | Parsing & indexing: repo folder → SQLite (files, nodes, edges) | C++17 | CLI binary |
| **Victor** | Embeddings & vector search: nodes → embeddings table + `search_symbols` | Python | Library imported by Ben's server |
| **Ben** | Retrieval, graph walk, LLM debugging agent, server, message routing (integration hub) | Python | FastAPI server |
| **Cameron** | Front-end: graph canvas, snippet drawer, chat panel | TypeScript | React app in browser |

Cameron's full name is Cameron Lau (the user is most likely him). Ben is the integration hub and should stay in close contact with all three others.

---

## 4. Architecture

```
Repo folder
   │
   ▼
[Josh, C++ indexer] ──► SQLite DB (files, nodes, edges)
                                  │
                 ┌────────────────┴─────────────┐
                 ▼                              ▼
   [Victor, Python embeddings]        [Ben, Python server]
   embeddings table + search_symbols ──► graph walk + LLM
                                              │ WebSocket
                                              ▼
                                    [Cameron, React UI]
```

**Only two real integration points exist:**
1. A **SQLite file** (Josh → everyone).
2. A **WebSocket** (Ben ↔ Cameron).

Victor and Ben are both Python, so `search_symbols` is a **plain function call** (no network hop).

### End-to-end flow of a question
1. UI connects to the server's WebSocket; server sends `graphData` (all nodes + edges).
2. User types a question (optionally with a selected node) → UI sends `askAI {question, nodeId?}`.
3. Ben resolves the target symbol: **exact SQLite match first**, Victor's `search_symbols` as **fallback**.
4. Ben runs a **depth-2 BFS** over the NetworkX graph for callers, callees and dependents.
5. Ben builds a prompt: target code + neighbor code + semantic chunks, and calls the LLM with streaming.
6. Ben sends `highlightNodes {ids}` (impacted nodes), then streams `chatToken {text}` repeatedly, then `chatDone`.
7. UI highlights the impacted nodes, renders streamed text in the chat panel, and highlights nodes the AI mentions.

---

## 5. Locked tech stack

| Layer | Technology |
|---|---|
| **Josh (indexer)** | C++17, CMake with FetchContent, tree-sitter core + `tree-sitter-typescript` (provides both `typescript` and `tsx` grammars), SQLite amalgamation (C API), `picosha2` (SHA-256), `std::filesystem`, `.scm` Tree-sitter query files for symbol extraction |
| **Victor (embeddings)** | Python, `sqlite3`, `numpy` (brute-force cosine similarity), embedding provider (see Section 6.2) |
| **Ben (server)** | Python, FastAPI + WebSockets, uvicorn, NetworkX, `sqlite3`, Pydantic (message models), LLM SDK with streaming (see Section 6.1) |
| **Cameron (UI)** | TypeScript, React, Vite, React Flow (`@xyflow/react`), `elkjs` (or `dagre`) for auto-layout, `zustand` (state), Tailwind CSS, Shiki (code highlighting) |
| **Shared** | SQLite database file (WAL mode enabled), JSON over WebSocket, `.env` / `.env.example` for config |

Notes:
- **No vector database.** A hackathon repo has a few thousand symbols; brute-force cosine in numpy is instant.
- **Switch to Cytoscape.js only if React Flow struggles** with the demo repo's size.
- Enable **SQLite WAL mode** so Josh's binary and Victor/Ben's readers/writers do not lock each other.

### 5.1 Config / providers

- **LLM provider [OPEN]:** not final. Leading candidate is the **OpenRouter free API**. See Section 6.1.
- **Embedding provider [DECIDED DEFAULT]:** **Ollama `nomic-embed-text` (local)**. See Section 6.2.
- **Provider abstraction rule:** provider, base URL, model name and API keys come from environment variables so swapping is a config change, not a code change.

---

## 6. Provider decisions

### 6.1 LLM (Ben) — [OPEN, leaning OpenRouter free tier]
- OpenRouter exposes an **OpenAI-compatible API**. Recommended approach: use the **`openai` Python SDK with a configurable `base_url`** (e.g. `https://openrouter.ai/api/v1`) and API key from env. That way switching to OpenAI, Anthropic's OpenAI-compatible endpoint, or any other provider is purely config.
- Suggested env vars: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Do **not** hardcode a model name in code.
- **Risk:** free-tier models usually have **tight rate limits and variable availability/quality**. Mitigations: keep prompts compact (target code + 2-hop neighbors, truncated), cache the answer for the scripted demo questions, have a backup model/provider key ready, and rehearse the demo path before presenting. Verify current free-tier limits on the day.
- Streaming is required (token-by-token over WebSocket).

### 6.2 Embeddings (Victor) — default decided
- **Default: Ollama with `nomic-embed-text`** (local, free, no API key; fits the "local-first" goal). Nomic's model works best with task prefixes (`search_document: ` for symbol bodies, `search_query: ` for queries).
- **Optional hosted mode:** Voyage `voyage-code-3` or OpenAI embeddings, selected by env var (`EMBEDDING_PROVIDER=ollama|voyage|openai`). Keep the provider behind one small function so swapping is trivial.
- **Constraint:** the same model must be used for indexing and querying; if the provider or model changes, the embeddings table must be rebuilt.
- Practical note: Ollama must be installed and the model pulled (`ollama pull nomic-embed-text`) on the machine that runs the embedding step. Victor owns that setup instructions in the README.

---

## 7. Per-person specs

### 7.1 Josh — Parsing & indexing (C++)
- **Input:** workspace folder path. **Output:** populated SQLite DB (files, nodes, edges).
- **CLI interface:** `indexer <workspace_path> <db_path>`
- **Goals:**
  1. Walk the directory, skipping `node_modules`, `.git`, `dist` (**hardcode first**, real `.gitignore` support later).
  2. SHA-256 hash every file; **only reparse new or changed files**.
  3. Run Tree-sitter queries to extract **functions, classes, imports and calls**.
  4. Write nodes and edges to SQLite; **delete a changed file's old rows before reinserting**.
  5. *Stretch:* a second language.
- **Build order (suggested):** (1) get CMake building Tree-sitter + SQLite first, this is where time disappears; (2) write dummy rows so Ben can read something; (3) parse one file; (4) queries; (5) CALLS edges using **simple name matching**; (6) incremental hashing.
- **IMPORTANT — stable node IDs:** IDs must be deterministic, e.g. `path::name::type`, **not auto-increment**. Otherwise Victor's embeddings are orphaned on every reindex.
- **Demo-repo specifics (iseo-player is React/TSX):** use the **`tsx` grammar for `.tsx` files**. Many React components/hooks are `const Foo = () => {...}` arrow functions or function expressions assigned to variables, so the function queries must capture `variable_declarator` with `arrow_function`/`function_expression` values as `function` nodes, not only `function_declaration`.
- **Deliverable early:** commit a **tiny sample DB** matching the schema as soon as possible, since everyone depends on it.

### 7.2 Victor — Embeddings & vector search (Python)
- **Input:** `nodes` rows from SQLite plus source text sliced by `start_line` / `end_line`. **Output:** `embeddings` table and `search_symbols(query, k)`.
- **Goals:**
  1. Slice each symbol's body using Josh's line ranges (**no fixed-size chunking**).
  2. Embed in **batches**.
  3. Store vectors as BLOBs in `embeddings(node_id, hash, vector)`; **only re-embed nodes whose hash changed** (hash comes from the `nodes.hash` column).
  4. Expose `search_symbols(query: str, k: int) -> list[{node_id, score}]` for Ben.
- Brute-force cosine in numpy; no vector DB. Enable WAL.
- Vector storage format **[PROPOSED]:** raw `float32` bytes (`numpy.ndarray.astype('float32').tobytes()`), same dimension for all rows.

### 7.3 Ben — Retrieval, LLM agent, server (Python)
- **Input:** user question + optional selected `node_id`. **Output:** `impactedNodeIds[]` + streamed explanation.
- **Goals:**
  1. Load SQLite edges into a **NetworkX** graph on startup.
  2. Resolve target symbol: **exact SQLite match first**, `search_symbols` as fallback.
  3. **Depth-2 BFS** for callers, callees and dependents.
  4. Build the prompt from target code, neighbors, and semantic chunks.
  5. Stream the LLM response **token by token** over the WebSocket.
  6. **Own the server and message routing** (hub for everyone).
  7. Also serve **graph JSON** and **code snippets** (read from the repo by line range) so Cameron's snippet drawer has content.
- **Semantics note:** an edge `source → target` of type `CALLS` means *source calls target*. "What breaks if I change X?" = **dependents of X = nodes with edges pointing INTO X** (reverse traversal). Callees (outgoing edges) are useful context for the prompt but are not "impacted".

### 7.4 Cameron — Front-end (TypeScript + React)
- **Input:** graph JSON, `impactedNodeIds[]`, streamed text tokens. **Output:** interactive graph UI + chat panel, plus user events sent back to the server.
- **Goals:**
  1. **Graph canvas with auto-layout.** React Flow does **not** position nodes for you; use `elkjs` (or `dagre`). Plan for this early.
  2. **Click a node** → highlight its dependents (computed client-side from the graph's edges) and open a **snippet drawer** (requests `nodeSnippet` from the server, highlighted with Shiki).
  3. **Chat panel** that renders streamed tokens and **highlights the nodes the AI mentions**.
  4. **zustand store** fed by the WebSocket connection.
  5. **Build against a hardcoded mock graph** until Josh's DB exists.
- **Suggested structure [PROPOSED]:** `ui/src/{main.tsx, App.tsx, store/useGraphStore.ts, ws/client.ts, types/contracts.ts, components/{GraphCanvas.tsx, NodeCard.tsx, SnippetDrawer.tsx, ChatPanel.tsx}, mocks/mockGraph.ts}`.
- **Store shape [PROPOSED]:** `nodes`, `edges`, `selectedNodeId`, `impactedNodeIds`, `snippets: Record<id, code>`, `chatMessages` (with a streaming assistant message), `connectionStatus`, `error`.
- **Performance tip:** if the demo repo graph is too cluttered, filter to file/function nodes, collapse by file, or only expand neighbors of the selected node before considering Cytoscape.

---

## 8. Contracts (the boundaries)

> A `CONTRACTS.md` in the repo root is the formal shared file (Python and TypeScript cannot share types, so Pydantic models and TS types must both match it). **Contracts are locked in the first 30 minutes of the hackathon.** Anything marked **[PROPOSED]** below is a recommended default that the team still needs to confirm. **Never change a shape silently; edit CONTRACTS.md and tell everyone.**

### 8.1 SQLite schema (Josh → Victor, Ben)

```sql
-- node.type: 'function' | 'class' | 'file'
-- edge.type: 'CALLS' | 'IMPORTS' | 'INHERITS_FROM' | 'DEFINES'
CREATE TABLE files (
  path TEXT PRIMARY KEY,        -- relative to workspace root, forward slashes
  hash TEXT NOT NULL            -- SHA-256 of file contents
);

CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,  -- stable: path::name::type
  type       TEXT NOT NULL,     -- function | class | file
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,     -- relative path
  start_line INTEGER NOT NULL,  -- [PROPOSED] 1-indexed, inclusive
  end_line   INTEGER NOT NULL,  -- [PROPOSED] 1-indexed, inclusive
  hash       TEXT NOT NULL      -- hash of the symbol's source text (drives re-embedding)
);

CREATE TABLE edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type      TEXT NOT NULL       -- CALLS | IMPORTS | INHERITS_FROM | DEFINES
);

-- Victor's table
CREATE TABLE embeddings (
  node_id TEXT PRIMARY KEY,
  hash    TEXT NOT NULL,        -- copy of nodes.hash at embedding time
  vector  BLOB NOT NULL         -- [PROPOSED] float32 bytes
);
```

- **Node ID format:** `src/db/pool.ts::DatabasePool::class`. For file nodes **[PROPOSED]**: `src/db/pool.ts::pool.ts::file`.
- **[OPEN]** ID collisions (two same-named functions in one file, overloads, nested functions): Josh to decide (e.g. append `#<start_line>` on collision). Must stay deterministic across reindexes.
- Enable **WAL mode** on the database.

### 8.2 Victor → Ben (Python function call)

```python
search_symbols(query: str, k: int) -> list[{"node_id": str, "score": float}]
```
- Score = cosine similarity, **[PROPOSED]** range 0 to 1, sorted **highest first**.

### 8.3 WebSocket (Ben ↔ Cameron)

**[PROPOSED]** endpoint: `ws://localhost:8000/ws` (FastAPI) and UI dev server on `http://localhost:5173` (Vite default). All messages are JSON objects with a `type` field. **[PROPOSED]** **camelCase on the wire** (Pydantic aliases on Ben's side, matching TS types on Cameron's side).

**Ben → Cameron**

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
```json
{ "type": "highlightNodes", "ids": ["src/api/users.ts::getUser::function"] }
```
```json
{ "type": "chatToken", "text": "Changing the pool size affects" }
```
```json
{ "type": "chatDone" }
```
```json
{ "type": "nodeSnippet", "id": "src/db/pool.ts::DatabasePool::class", "code": "export class DatabasePool { ... }" }
```

**Cameron → Ben**

```json
{ "type": "askAI", "question": "What breaks if I change DatabasePool?", "nodeId": "src/db/pool.ts::DatabasePool::class" }
```
```json
{ "type": "nodeClicked", "id": "src/db/pool.ts::DatabasePool::class" }
```
(`nodeId` in `askAI` is optional.)

**Full message list:** `graphData`, `highlightNodes`, `chatToken`, `chatDone`, `nodeSnippet` (Ben → Cameron); `nodeClicked`, `askAI` (Cameron → Ben).

**[PROPOSED] sequencing and behavior:**
- `graphData` is sent once when the socket connects.
- On `askAI`: Ben sends `highlightNodes` first (as soon as the impact set is known), then many `chatToken`, then `chatDone`.
- On `nodeClicked`: Ben replies with `nodeSnippet` for that node (dependents highlighting is done client-side).
- Nothing impacted → `highlightNodes` with `"ids": []`.
- Symbol not found → Ben still responds with a short `chatToken` explanation, then `chatDone` (no hanging UI).
- **[PROPOSED] error shape**, so the UI can show failures instead of hanging: `{ "type": "error", "message": "human readable text", "code": "SYMBOL_NOT_FOUND | LLM_ERROR | INTERNAL" }`.

### 8.4 Conventions (the part people forget)
- **Line numbers:** [PROPOSED] 1-indexed, inclusive start and end. (DB uses `start_line`/`end_line`; JSON on the wire uses `startLine`/`endLine`.)
- **Paths:** relative to the workspace root, forward slashes, never absolute.
- **Naming:** snake_case in Python/SQLite, camelCase on the wire. The one translation point is Ben's Pydantic models.
- **Changes:** contract changes need everyone's OK and a `CONTRACTS.md` edit.

---

## 9. Timeline

- **Hour 0–1:** agree on contracts (write `CONTRACTS.md` with all four together), pick/confirm the demo repo, everyone builds mocks of their inputs (Cameron: hardcoded graph; Ben: small test DB; Victor: a few fake nodes).
- **Middle:** build independently. **Josh ships a first DB on a small sample repo as early as possible.**
- **Final stretch:** Ben and Cameron integrate end-to-end; Josh and Victor fix bugs/performance; **rehearse the demo**.

**Suggested repo layout [PROPOSED]:**
```
repo-root/
├── CONTRACTS.md
├── README.md            # one-page run commands for each piece (hand-maintained)
├── CHANGES.md           # append-only change log (see Section 0, rule 8)
├── .env.example         # shared config template
├── sample.db            # tiny committed DB matching the schema
├── indexer/             # Josh (C++/CMake)
├── embeddings/          # Victor (Python)
├── server/              # Ben (FastAPI)
└── ui/                  # Cameron (React/Vite)
```

---

## 10. Demo plan [PROPOSED]
- Index `iseo-player`, open the UI, show the graph, click a node to show dependents + snippet drawer, ask *"What breaks if I change <some core hook/component>?"*, watch the nodes light up while the answer streams.
- Pre-test 2–3 questions that give good results with the real graph; pre-cache their answers as a fallback if the LLM API is slow or rate-limited.

---

## 11. Risks and fallbacks
- **C++ build pain (Josh):** share a prebuilt binary or commit the generated `.db` for the demo repo. If the build fights back at the midpoint, a Python tree-sitter fallback is the escape hatch (this is the main condition under which the stack may change, and only by team decision).
- **Call-edge accuracy:** simple name matching will create some wrong edges. Acceptable for a demo; choose questions/nodes where the result looks right.
- **Three languages:** keep a shared `.env.example` and a one-page README with run commands for each piece so nobody loses time at integration.
- **LLM free-tier limits:** see Section 6.1 (cache demo answers, keep a backup key/model).
- **React Flow scaling:** filter/collapse nodes first; Cytoscape.js only as a last resort.
- **Auto-layout:** React Flow needs elk/dagre layout; plan for it early (layout can be slow for large graphs, so run it once and cache positions).

---

## 12. Open questions / not yet decided (update this section as things get decided)

1. **[OPEN]** Hackathon name, duration, deadline and judging criteria.
2. **[OPEN]** Final LLM provider/model (leading candidate: OpenRouter free API, via an OpenAI-compatible SDK with env-configured base URL).
3. **[OPEN]** Node ID collision handling (Josh).
4. **[PROPOSED, needs team confirmation]** camelCase on the wire, 1-indexed inclusive line numbers, relative forward-slash paths, error message shape, WebSocket endpoint/ports, float32 vector format.
5. **[OPEN]** Whether a second language is attempted (stretch for Josh; MVP is TypeScript/TSX only).

---

## 13. Glossary
- **Node:** a symbol in the graph (`function`, `class`, or `file`).
- **Edge:** a relationship: `CALLS`, `IMPORTS`, `INHERITS_FROM`, `DEFINES`. Direction is `source → target` (source calls/imports/inherits/defines target).
- **Impacted / dependent nodes:** nodes that would be affected if the target changes (reverse-direction traversal, depth 2).
- **Hybrid retrieval:** graph hop traversal (structure) combined with `search_symbols` (semantic).
- **`highlightNodes`:** the message that makes impacted nodes light up in the UI.

---

## 14. Change log

The change log lives in its own file, **`CHANGES.md`** at the repo root (see Section 0, rule 8). Like `super.md` and `CONTRACTS.md`, it changes only through a PR to `main`; the webmaster merges it and may batch entries from several people in one PR.
