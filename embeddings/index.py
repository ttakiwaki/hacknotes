from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from embeddings import config
from embeddings.db import connect
from embeddings.providers import EmbeddingProvider, get_provider
from embeddings.slice import slice_symbol
from embeddings.vectors import to_blob

log = logging.getLogger(__name__)


def index_embeddings(
    db_path: str | Path | None = None,
    workspace: str | Path | None = None,
    provider: EmbeddingProvider | None = None,
) -> dict[str, int]:
    """Embed changed/new nodes. Skip nodes whose hash still matches.

    Returns counts: embedded, skipped, deleted, missing_source.
    """
    db = Path(db_path) if db_path else config.db_path()
    root = Path(workspace) if workspace else config.workspace_path()
    embedder = provider or get_provider()
    batch_size = config.embedding_batch_size()

    conn = connect(db)
    try:
        nodes = list(
            conn.execute(
                "SELECT id, path, start_line, end_line, hash FROM nodes"
            )
        )
        existing = {
            row["node_id"]: row["hash"]
            for row in conn.execute("SELECT node_id, hash FROM embeddings")
        }
        live_ids = {row["id"] for row in nodes}

        stale = [node_id for node_id in existing if node_id not in live_ids]
        if stale:
            conn.executemany(
                "DELETE FROM embeddings WHERE node_id = ?",
                [(node_id,) for node_id in stale],
            )

        to_embed: list[tuple[str, str, str]] = []  # id, hash, text
        missing_source = 0
        skipped = 0
        for row in nodes:
            if existing.get(row["id"]) == row["hash"]:
                skipped += 1
                continue
            try:
                text = slice_symbol(
                    root, row["path"], row["start_line"], row["end_line"]
                )
            except FileNotFoundError:
                log.warning("skip %s: source file missing", row["id"])
                missing_source += 1
                continue
            if not text.strip():
                log.warning("skip %s: empty source slice", row["id"])
                missing_source += 1
                continue
            to_embed.append((row["id"], row["hash"], text))

        embedded = 0
        for start in range(0, len(to_embed), batch_size):
            chunk = to_embed[start : start + batch_size]
            vectors = embedder.embed_documents([item[2] for item in chunk])
            if vectors.ndim != 2 or vectors.shape[0] != len(chunk):
                raise RuntimeError(
                    f"provider returned shape {getattr(vectors, 'shape', None)}, "
                    f"expected ({len(chunk)}, dim)"
                )
            rows = []
            for (node_id, node_hash, _), vec in zip(chunk, vectors, strict=True):
                rows.append((node_id, node_hash, to_blob(np.asarray(vec))))
            conn.executemany(
                """
                INSERT INTO embeddings (node_id, hash, vector)
                VALUES (?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                  hash = excluded.hash,
                  vector = excluded.vector
                """,
                rows,
            )
            embedded += len(chunk)

        conn.commit()
        return {
            "embedded": embedded,
            "skipped": skipped,
            "deleted": len(stale),
            "missing_source": missing_source,
        }
    finally:
        conn.close()
