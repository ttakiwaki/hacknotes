from __future__ import annotations

import numpy as np


def to_blob(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype="<f4").tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype="<f4").copy()


def l2_normalize(matrix: np.ndarray, *, axis: int = 1) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=axis, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return matrix / norms


def cosine_scores(matrix: np.ndarray, query: np.ndarray) -> np.ndarray:
    """Row-wise cosine similarity. Returns values clamped to [0, 1]."""
    if matrix.size == 0:
        return np.zeros((0,), dtype=np.float32)
    docs = l2_normalize(np.asarray(matrix, dtype=np.float32), axis=1)
    q = l2_normalize(np.asarray(query, dtype=np.float32).reshape(1, -1), axis=1)[0]
    raw = docs @ q
    return np.clip(raw, 0.0, 1.0).astype(np.float32)
