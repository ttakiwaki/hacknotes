from __future__ import annotations

import sqlite3
from pathlib import Path

EMBEDDINGS_DDL = """
CREATE TABLE IF NOT EXISTS embeddings (
  node_id TEXT PRIMARY KEY,
  hash    TEXT NOT NULL,
  vector  BLOB NOT NULL
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute(EMBEDDINGS_DDL)
    return conn
