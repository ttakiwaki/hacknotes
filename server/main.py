import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from contracts import (
    AskAI,
    ChatDone,
    ChatToken,
    ErrorMessage,
    GraphData,
    GraphEdge,
    GraphNode,
    HighlightNodes,
    NodeClicked,
    NodeSnippet,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mock data matching CONTRACTS.md Section 7
MOCK_NODES = [
    GraphNode(id="src/db/pool.ts::pool.ts::file", type="file", name="pool.ts", path="src/db/pool.ts", start_line=1, end_line=90),
    GraphNode(id="src/db/pool.ts::DatabasePool::class", type="class", name="DatabasePool", path="src/db/pool.ts", start_line=10, end_line=84),
    GraphNode(id="src/api/users.ts::users.ts::file", type="file", name="users.ts", path="src/api/users.ts", start_line=1, end_line=40),
    GraphNode(id="src/api/users.ts::getUser::function", type="function", name="getUser", path="src/api/users.ts", start_line=5, end_line=22),
    GraphNode(id="src/api/users.ts::listUsers::function", type="function", name="listUsers", path="src/api/users.ts", start_line=24, end_line=38),
    GraphNode(id="src/server.ts::server.ts::file", type="file", name="server.ts", path="src/server.ts", start_line=1, end_line=30),
    GraphNode(id="src/server.ts::startServer::function", type="function", name="startServer", path="src/server.ts", start_line=8, end_line=28),
]

MOCK_EDGES = [
    GraphEdge(source="src/db/pool.ts::pool.ts::file", target="src/db/pool.ts::DatabasePool::class", type="DEFINES"),
    GraphEdge(source="src/api/users.ts::users.ts::file", target="src/api/users.ts::getUser::function", type="DEFINES"),
    GraphEdge(source="src/api/users.ts::users.ts::file", target="src/api/users.ts::listUsers::function", type="DEFINES"),
    GraphEdge(source="src/server.ts::server.ts::file", target="src/server.ts::startServer::function", type="DEFINES"),
    GraphEdge(source="src/api/users.ts::users.ts::file", target="src/db/pool.ts::pool.ts::file", type="IMPORTS"),
    GraphEdge(source="src/server.ts::server.ts::file", target="src/api/users.ts::users.ts::file", type="IMPORTS"),
    GraphEdge(source="src/api/users.ts::getUser::function", target="src/db/pool.ts::DatabasePool::class", type="CALLS"),
    GraphEdge(source="src/api/users.ts::listUsers::function", target="src/db/pool.ts::DatabasePool::class", type="CALLS"),
    GraphEdge(source="src/server.ts::startServer::function", target="src/api/users.ts::getUser::function", type="CALLS"),
]


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Step 1: Send full graphData on connect
    graph_msg = GraphData(nodes=MOCK_NODES, edges=MOCK_EDGES)
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

            if msg_type == "nodeClicked":
                try:
                    msg = NodeClicked.model_validate(payload)
                    # Mock snippet payload for testing
                    snippet = NodeSnippet(
                        id=msg.id,
                        code=f"// Snippet for {msg.id}\nexport class Sample {{\n  // code goes here\n}}"
                    )
                    await websocket.send_text(snippet.model_dump_json(by_alias=True))
                except ValidationError as e:
                    err = ErrorMessage(code="BAD_REQUEST", message=str(e))
                    await websocket.send_text(err.model_dump_json(by_alias=True))

            elif msg_type == "askAI":
                try:
                    msg = AskAI.model_validate(payload)

                    # Mock depth-2 reverse traversal response for testing
                    impacted_ids = [
                        "src/api/users.ts::getUser::function",
                        "src/api/users.ts::listUsers::function",
                        "src/server.ts::startServer::function",
                    ]
                    
                    highlight_msg = HighlightNodes(ids=impacted_ids)
                    await websocket.send_text(highlight_msg.model_dump_json(by_alias=True))

                    # Stream sample tokens
                    tokens = [
                        "Changing ", "`DatabasePool` ", "affects ", "`getUser` ", 
                        "and ", "`listUsers` ", "in `users.ts`.", " Consequently, ", 
                        "`startServer` ", "is also impacted."
                    ]
                    for token in tokens:
                        chat_token = ChatToken(text=token)
                        await websocket.send_text(chat_token.model_dump_json(by_alias=True))

                    await websocket.send_text(ChatDone().model_dump_json(by_alias=True))

                except ValidationError as e:
                    err = ErrorMessage(code="BAD_REQUEST", message=str(e))
                    await websocket.send_text(err.model_dump_json(by_alias=True))

            else:
                # Log and ignore unknown message types per CONTRACTS.md Section 3
                print(f"Warning: Received unknown message type '{msg_type}'")

    except WebSocketDisconnect:
        print("Client disconnected.")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("SERVER_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)