"""Victor's embeddings library: index symbol bodies and search them.

Ben imports ``search_symbols`` from this package (repo root on PYTHONPATH):

    from embeddings import search_symbols
    hits = search_symbols("What breaks if I change DatabasePool?", k=5)
"""

from embeddings.search import search_symbols
from embeddings.index import index_embeddings
from embeddings.types import SymbolHit

__all__ = ["search_symbols", "index_embeddings", "SymbolHit"]
