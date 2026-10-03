# Server Implementation Changelog (Ben)

**Date:** October 3, 2026  
**Author:** Ben (Python / FastAPI / Integration Server)

## Summary of Changes

Implemented the full Python integration server layer connecting Josh's SQLite codebase index, Victor's semantic search module, and Cameron's React frontend according to `CONTRACTS.md` v0.1.

---

## Detailed Components Implemented

### 1. Pydantic v2 Wire Contracts (`server/contracts.py`)
- Created `WireModel` base class configured with `alias_generator=to_camel` and `populate_by_name=True` for seamless `snake_case` (Python) to `camelCase` (JSON wire format) transformation.
- Defined wire data models matching Section 6.2 of `CONTRACTS.md`:
  - **Graph Models:** `GraphNode`, `GraphEdge`
  - **Server -> Client Messages:** `GraphData`, `HighlightNodes`, `ChatToken`, `ChatDone`, `NodeSnippet`, `ErrorMessage`
  - **Client -> Server Messages:** `AskAI`, `NodeClicked`
  - **Unions & Types:** `NodeType`, `EdgeType`, `ErrorCode`, `ServerMessage`, `ClientMessage`

### 2. NetworkX Graph Engine & Reader (`server/graph_engine.py`)
- **SQLite Database Reader:** Implemented SQLite connector configured in WAL journal mode (`PRAGMA journal_mode=WAL;`) to safely read `nodes` and `edges` tables alongside Josh's writer binary.
- **Graph Builder:** Constructed a NetworkX directed graph (`nx.DiGraph`) storing graph nodes and directed relationship edges (`CALLS`, `INHERITS_FROM`, `IMPORTS`, `DEFINES`).
- **Reverse Depth-2 Impact BFS:** Implemented reverse graph traversal on `CALLS` and `INHERITS_FROM` edges to compute affected dependent symbols up to 2 hops away ("What breaks if I change X?").
- **Snippet Extractor:** Built code snippet extractor reading raw source files by joining `WORKSPACE_PATH` with relative file paths and slicing 1-indexed inclusive line ranges (`start_line..end_line`).

### 3. Target Resolution & Streaming Agent (`server/llm_agent.py`)
- **Target Resolver:** Implemented multi-stage symbol lookup logic for `askAI` requests:
  1. Direct match on explicit `nodeId` parameter.
  2. Exact match in database by node name or ID.
  3. Semantic fallback search invoking Victor's `search_symbols(query, k)` module.
- **Streaming LLM Agent:** Integrated `openai.AsyncOpenAI` client targeting OpenRouter (`https://openrouter.ai/api/v1`). Built prompt builder aggregating target symbol code and dependent neighbor snippets, streaming `chatToken` chunks token-by-token over WebSocket.

### 4. FastAPI WebSocket Endpoint (`server/main.py`)
- **Server Hub:** Configured FastAPI application with CORS middleware enabled for Vite frontend (`http://localhost:5173`).
- **Lifecycle Integration:** Configured graph auto-loading on server startup and client connection.
- **WebSocket Route (`/ws`):**
  - Sends complete `graphData` frame on client connect.
  - Handles `nodeClicked` messages by returning `nodeSnippet` payloads.
  - Handles `askAI` messages by resolving targets, firing `highlightNodes`, streaming `chatToken` responses, and concluding with `chatDone`.
  - Catches invalid payloads or execution errors and emits structured `error` frames (`SYMBOL_NOT_FOUND`, `LLM_ERROR`, `BAD_REQUEST`, `INTERNAL`).

---

## Contract Compliance Audit

| Requirement | Implementation Status |
|---|---|
| CamelCase on wire | Completed via `WireModel` Pydantic aliases |
| SQLite WAL mode | Enabled in `graph_engine.py` |
| Depth-2 reverse BFS | Implemented in `GraphEngine.get_impacted_nodes` |
| 1-indexed line numbers | Handled in `GraphEngine.get_snippet` |
| Port configuration | Default `8000`, overridable via `SERVER_PORT` |
| Error handling | Emits structured `ErrorMessage` wire objects |