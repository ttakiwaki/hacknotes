from __future__ import annotations

import hashlib
from pathlib import Path

from embeddings.db import connect
from embeddings.slice import slice_symbol

# Same IDs as CONTRACTS.md Section 7.
NODES = [
    {
        "id": "src/db/pool.ts::pool.ts::file",
        "type": "file",
        "name": "pool.ts",
        "path": "src/db/pool.ts",
        "start_line": 1,
        "end_line": 90,
    },
    {
        "id": "src/db/pool.ts::DatabasePool::class",
        "type": "class",
        "name": "DatabasePool",
        "path": "src/db/pool.ts",
        "start_line": 10,
        "end_line": 84,
    },
    {
        "id": "src/api/users.ts::users.ts::file",
        "type": "file",
        "name": "users.ts",
        "path": "src/api/users.ts",
        "start_line": 1,
        "end_line": 40,
    },
    {
        "id": "src/api/users.ts::getUser::function",
        "type": "function",
        "name": "getUser",
        "path": "src/api/users.ts",
        "start_line": 5,
        "end_line": 22,
    },
    {
        "id": "src/api/users.ts::listUsers::function",
        "type": "function",
        "name": "listUsers",
        "path": "src/api/users.ts",
        "start_line": 24,
        "end_line": 38,
    },
    {
        "id": "src/server.ts::server.ts::file",
        "type": "file",
        "name": "server.ts",
        "path": "src/server.ts",
        "start_line": 1,
        "end_line": 30,
    },
    {
        "id": "src/server.ts::startServer::function",
        "type": "function",
        "name": "startServer",
        "path": "src/server.ts",
        "start_line": 8,
        "end_line": 28,
    },
]

EDGES = [
    ("src/db/pool.ts::pool.ts::file", "src/db/pool.ts::DatabasePool::class", "DEFINES"),
    ("src/api/users.ts::users.ts::file", "src/api/users.ts::getUser::function", "DEFINES"),
    ("src/api/users.ts::users.ts::file", "src/api/users.ts::listUsers::function", "DEFINES"),
    ("src/server.ts::server.ts::file", "src/server.ts::startServer::function", "DEFINES"),
    ("src/api/users.ts::users.ts::file", "src/db/pool.ts::pool.ts::file", "IMPORTS"),
    ("src/server.ts::server.ts::file", "src/api/users.ts::users.ts::file", "IMPORTS"),
    ("src/api/users.ts::getUser::function", "src/db/pool.ts::DatabasePool::class", "CALLS"),
    ("src/api/users.ts::listUsers::function", "src/db/pool.ts::DatabasePool::class", "CALLS"),
    ("src/server.ts::startServer::function", "src/api/users.ts::getUser::function", "CALLS"),
]


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write_workspace(root: Path) -> None:
    pool = [f"// pool.ts line {i}\n" for i in range(1, 91)]
    pool[9] = "export class DatabasePool {\n"
    for i in range(10, 83):
        pool[i] = "  acquire() { /* connection pool checkout */ }\n"
    pool[83] = "}\n"
    users = [f"// users.ts line {i}\n" for i in range(1, 41)]
    users[4] = "export function getUser(id: string) {\n"
    for i in range(5, 21):
        users[i] = "  return DatabasePool.acquire().findUser(id);\n"
    users[21] = "}\n"
    users[23] = "export function listUsers() {\n"
    for i in range(24, 37):
        users[i] = "  return DatabasePool.acquire().allUsers();\n"
    users[37] = "}\n"
    server = [f"// server.ts line {i}\n" for i in range(1, 31)]
    server[7] = "export function startServer() {\n"
    for i in range(8, 27):
        server[i] = "  app.get('/user', () => getUser('1'));\n"
    server[27] = "}\n"

    files = {
        "src/db/pool.ts": "".join(pool),
        "src/api/users.ts": "".join(users),
        "src/server.ts": "".join(server),
    }
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def seed_sample(db_path: Path, workspace: Path) -> dict[str, str | int]:
    workspace.mkdir(parents=True, exist_ok=True)
    _write_workspace(workspace)
    if db_path.exists():
        db_path.unlink()
    conn = connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS files (
              path TEXT PRIMARY KEY,
              hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nodes (
              id         TEXT PRIMARY KEY,
              type       TEXT NOT NULL,
              name       TEXT NOT NULL,
              path       TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line   INTEGER NOT NULL,
              hash       TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS edges (
              source_id TEXT NOT NULL,
              target_id TEXT NOT NULL,
              type      TEXT NOT NULL,
              PRIMARY KEY (source_id, target_id, type)
            );
            """
        )
        for node in NODES:
            body = slice_symbol(
                workspace, node["path"], node["start_line"], node["end_line"]
            )
            node_hash = _sha256(body)
            conn.execute(
                """
                INSERT INTO nodes (id, type, name, path, start_line, end_line, hash)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    node["id"],
                    node["type"],
                    node["name"],
                    node["path"],
                    node["start_line"],
                    node["end_line"],
                    node_hash,
                ),
            )
        files: dict[str, str] = {}
        for node in NODES:
            files[node["path"]] = _sha256((workspace / node["path"]).read_text())
        for path, file_hash in files.items():
            conn.execute(
                "INSERT INTO files (path, hash) VALUES (?, ?)",
                (path, file_hash),
            )
        conn.executemany(
            "INSERT INTO edges (source_id, target_id, type) VALUES (?, ?, ?)",
            EDGES,
        )
        conn.commit()
        n_nodes = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        n_edges = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    finally:
        conn.close()
    return {
        "db_path": str(db_path.resolve()),
        "workspace": str(workspace.resolve()),
        "nodes": int(n_nodes),
        "edges": int(n_edges),
    }
