from typing import TypedDict


class SymbolHit(TypedDict):
    node_id: str
    score: float  # cosine, 0..1, sorted descending in the returned list
