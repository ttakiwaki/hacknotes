from __future__ import annotations

from pathlib import Path

import numpy as np

from embeddings import config
from embeddings.db import connect
from embeddings.providers import EmbeddingProvider, get_provider
from embeddings.types import SymbolHit
from embeddings.vectors import cosine_scores, from_blob


def search_symbols(
    query: str,
    k: int,
    *,
    db_path: str | Path | None = None,
    provider: EmbeddingProvider | None = None,
) -> list[SymbolHit]:
    """Semantic search over embedded symbols.

    Returns up to k items, sorted by score descending (best first).
    Returns [] if the embeddings table is empty or query is blank.
    Raises only for real failures (e.g. embedding provider unreachable).
    """
    if k <= 0 or not query or not query.strip():
        return []

    db = Path(db_path) if db_path else config.db_path()
    conn = connect(db)
    try:
        rows = list(conn.execute("SELECT node_id, vector FROM embeddings"))
    finally:
        conn.close()

    if not rows:
        return []

    matrix = np.stack([from_blob(row["vector"]) for row in rows])
    embedder = provider or get_provider()
    query_vec = np.asarray(embedder.embed_query(query), dtype=np.float32)
    if query_vec.ndim != 1:
        query_vec = query_vec.reshape(-1)
    if query_vec.shape[0] != matrix.shape[1]:
        raise RuntimeError(
            f"query dim {query_vec.shape[0]} != stored dim {matrix.shape[1]}. "
            "Rebuild the embeddings table with the same model used for queries."
        )

    scores = cosine_scores(matrix, query_vec)
    order = np.argsort(-scores)[:k]
    hits: list[SymbolHit] = []
    for idx in order:
        hits.append({"node_id": rows[int(idx)]["node_id"], "score": float(scores[idx])})
    return hits
