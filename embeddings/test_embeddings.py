from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np

from embeddings.index import index_embeddings
from embeddings.search import search_symbols
from embeddings.seed_sample import seed_sample
from embeddings.vectors import cosine_scores, from_blob, to_blob


class FakeProvider:
    dim = 32

    def _vec(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dim, dtype=np.float32)
        for token in text.lower().replace("{", " ").replace("}", " ").split():
            digest = hashlib.md5(token.encode("utf-8")).digest()
            vec[digest[0] % self.dim] += 1.0 + digest[1] / 255.0
        return vec

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vec(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._vec(text)


class EmbeddingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "sample.db"
        self.workspace = self.root / "workspace"
        seed_sample(self.db, self.workspace)
        self.provider = FakeProvider()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_index_then_search_finds_pool(self) -> None:
        stats = index_embeddings(self.db, self.workspace, self.provider)
        self.assertEqual(stats["embedded"], 7)
        self.assertEqual(stats["skipped"], 0)
        hits = search_symbols(
            "connection pool checkout",
            3,
            db_path=self.db,
            provider=self.provider,
        )
        self.assertTrue(hits)
        self.assertEqual(hits[0]["node_id"], "src/db/pool.ts::DatabasePool::class")
        self.assertGreaterEqual(hits[0]["score"], hits[-1]["score"])
        self.assertGreaterEqual(hits[0]["score"], 0.0)
        self.assertLessEqual(hits[0]["score"], 1.0)

    def test_incremental_skips_unchanged(self) -> None:
        index_embeddings(self.db, self.workspace, self.provider)
        stats = index_embeddings(self.db, self.workspace, self.provider)
        self.assertEqual(stats["embedded"], 0)
        self.assertEqual(stats["skipped"], 7)

    def test_reembeds_when_hash_changes(self) -> None:
        index_embeddings(self.db, self.workspace, self.provider)
        import sqlite3

        conn = sqlite3.connect(self.db)
        conn.execute(
            "UPDATE nodes SET hash = 'deadbeef' WHERE id = ?",
            ("src/db/pool.ts::DatabasePool::class",),
        )
        conn.commit()
        conn.close()
        stats = index_embeddings(self.db, self.workspace, self.provider)
        self.assertEqual(stats["embedded"], 1)
        self.assertEqual(stats["skipped"], 6)

    def test_deletes_orphaned_embeddings(self) -> None:
        index_embeddings(self.db, self.workspace, self.provider)
        import sqlite3

        conn = sqlite3.connect(self.db)
        conn.execute(
            "DELETE FROM nodes WHERE id = ?",
            ("src/server.ts::startServer::function",),
        )
        conn.commit()
        conn.close()
        stats = index_embeddings(self.db, self.workspace, self.provider)
        self.assertEqual(stats["deleted"], 1)
        hits = search_symbols(
            "startServer",
            10,
            db_path=self.db,
            provider=self.provider,
        )
        ids = [h["node_id"] for h in hits]
        self.assertNotIn("src/server.ts::startServer::function", ids)

    def test_empty_table_returns_empty(self) -> None:
        hits = search_symbols("anything", 5, db_path=self.db, provider=self.provider)
        self.assertEqual(hits, [])

    def test_float32_blob_roundtrip(self) -> None:
        vec = np.array([0.5, -0.25, 0.0], dtype=np.float32)
        restored = from_blob(to_blob(vec))
        np.testing.assert_array_equal(restored, vec)

    def test_cosine_clamps_negative(self) -> None:
        matrix = np.array([[1.0, 0.0], [-1.0, 0.0]], dtype=np.float32)
        query = np.array([1.0, 0.0], dtype=np.float32)
        scores = cosine_scores(matrix, query)
        self.assertAlmostEqual(float(scores[0]), 1.0, places=5)
        self.assertAlmostEqual(float(scores[1]), 0.0, places=5)


if __name__ == "__main__":
    unittest.main()
