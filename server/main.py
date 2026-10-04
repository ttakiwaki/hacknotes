import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from server.contracts import (
    AskAI,
    ChatDone,
    ChatToken,
    ErrorMessage,
    GraphData,
    HighlightNodes,
    LoadRepository,
    NodeClicked,
    NodeSnippet,
)
from server.graph_engine import GraphEngine
from server.llm_agent import LLMAgent

# Attempt importing Victor's search_symbols library
try:
    from embeddings import search_symbols
except ImportError:
    search_symbols = None

load_dotenv()

WORKSPACE_PATH = os.getenv("WORKSPACE_PATH", "./")
DB_PATH = os.getenv("DB_PATH", "./index.db")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

graph_engine = GraphEngine(db_path=DB_PATH, workspace_path=WORKSPACE_PATH)
llm_agent = LLMAgent(graph_engine=graph_engine, search_symbols_fn=search_symbols)


@app.on_event("startup")
def startup_event():
    graph_engine.load_from_db()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    repository_url = None

    # Always reload graph on connect to catch DB updates
    graph_engine.load_from_db()

    # 1. Send full graphData on connect
    graph_msg = GraphData(
        nodes=list(graph_engine.nodes_dict.values()),
        edges=graph_engine.edges_list,
    )
    await websocket.send_text(graph_msg.model_dump_json(by_alias=True))

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                err = ErrorMessage(code="BAD_REQUEST", message="Invalid JSON format.")
                await websocket.send_text(err.model_dump_json(by_alias=True))
                continue

            msg_type = payload.get("type")

            if msg_type == "loadRepository":
                try:
                    msg = LoadRepository.model_validate(payload)
                    repository_url = msg.repository_url
                    print(f"Repository requested: {repository_url}")
                    graph_engine.load_from_db()
                    graph_msg = GraphData(
                        nodes=list(graph_engine.nodes_dict.values()),
                        edges=graph_engine.edges_list,
                    )
                    await websocket.send_text(
                        graph_msg.model_dump_json(by_alias=True)
                    )
                except ValidationError as e:
                    err = ErrorMessage(code="BAD_REQUEST", message=str(e))
                    await websocket.send_text(err.model_dump_json(by_alias=True))

            elif msg_type == "nodeClicked":
                try:
                    msg = NodeClicked.model_validate(payload)
                    snippet_code = graph_engine.get_snippet(msg.id)
                    if snippet_code is None:
                        err = ErrorMessage(code="SYMBOL_NOT_FOUND", message=f"Symbol '{msg.id}' not found.")
                        await websocket.send_text(err.model_dump_json(by_alias=True))
                    else:
                        snippet_msg = NodeSnippet(id=msg.id, code=snippet_code)
                        await websocket.send_text(snippet_msg.model_dump_json(by_alias=True))
                except ValidationError as e:
                    err = ErrorMessage(code="BAD_REQUEST", message=str(e))
                    await websocket.send_text(err.model_dump_json(by_alias=True))

            elif msg_type == "askAI":
                try:
                    msg = AskAI.model_validate(payload)

                    # Target Resolution
                    target_id = llm_agent.resolve_target(msg.question, msg.node_id)
                    if not target_id:
                        err = ErrorMessage(
                            code="SYMBOL_NOT_FOUND",
                            message=f"Could not resolve target symbol for question: '{msg.question}'"
                        )
                        await websocket.send_text(err.model_dump_json(by_alias=True))
                        continue

                    # Reverse Depth-2 BFS
                    impacted_ids = graph_engine.get_impacted_nodes(target_id, max_depth=2)

                    # Send highlightNodes first
                    highlight_msg = HighlightNodes(ids=impacted_ids)
                    await websocket.send_text(highlight_msg.model_dump_json(by_alias=True))

                    # Stream LLM tokens
                    try:
                        async for token in llm_agent.stream_explanation(msg.question, target_id, impacted_ids):
                            chat_token = ChatToken(text=token)
                            await websocket.send_text(chat_token.model_dump_json(by_alias=True))

                        await websocket.send_text(ChatDone().model_dump_json(by_alias=True))
                    except Exception as e:
                        err = ErrorMessage(code="LLM_ERROR", message=f"LLM streaming failed: {str(e)}")
                        await websocket.send_text(err.model_dump_json(by_alias=True))

                except ValidationError as e:
                    err = ErrorMessage(code="BAD_REQUEST", message=str(e))
                    await websocket.send_text(err.model_dump_json(by_alias=True))

            else:
                print(f"Warning: Received unknown message type '{msg_type}'")

    except WebSocketDisconnect:
        print("Client disconnected.")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("SERVER_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)