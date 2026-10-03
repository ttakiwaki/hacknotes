from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Protocol

import numpy as np

from embeddings import config


class EmbeddingProvider(Protocol):
    def embed_documents(self, texts: list[str]) -> np.ndarray: ...
    def embed_query(self, text: str) -> np.ndarray: ...


def get_provider(name: str | None = None) -> EmbeddingProvider:
    chosen = (name or config.embedding_provider_name()).lower()
    if chosen == "ollama":
        return OllamaProvider()
    if chosen == "voyage":
        return VoyageProvider()
    if chosen == "openai":
        return OpenAIProvider()
    raise ValueError(
        f"Unknown EMBEDDING_PROVIDER={chosen!r}. Use ollama, voyage, or openai."
    )


def _http_json(
    url: str,
    payload: dict,
    headers: dict[str, str] | None = None,
    timeout: float = 120,
) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Embedding HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Embedding provider unreachable at {url}: {exc}") from exc


class OllamaProvider:
    def __init__(self, host: str | None = None, model: str | None = None) -> None:
        self.host = host or config.ollama_host()
        self.model = model or config.embedding_model()

    def _prefix_docs(self, text: str) -> str:
        if "nomic" in self.model:
            return f"search_document: {text}"
        return text

    def _prefix_query(self, text: str) -> str:
        if "nomic" in self.model:
            return f"search_query: {text}"
        return text

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._embed([self._prefix_docs(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._embed([self._prefix_query(text)])[0]

    def _embed(self, texts: list[str]) -> np.ndarray:
        data = _http_json(
            f"{self.host}/api/embed",
            {"model": self.model, "input": texts},
        )
        vectors = data.get("embeddings")
        if not vectors:
            raise RuntimeError(f"Ollama returned no embeddings: {data!r}")
        return np.asarray(vectors, dtype=np.float32)


class VoyageProvider:
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else config.embedding_api_key()
        self.model = model or config.embedding_model()
        if not self.api_key:
            raise RuntimeError("EMBEDDING_API_KEY is required for voyage")

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._embed(texts, "document")

    def embed_query(self, text: str) -> np.ndarray:
        return self._embed([text], "query")[0]

    def _embed(self, texts: list[str], input_type: str) -> np.ndarray:
        data = _http_json(
            "https://api.voyageai.com/v1/embeddings",
            {"model": self.model, "input": texts, "input_type": input_type},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        rows = data.get("data") or []
        rows = sorted(rows, key=lambda r: r["index"])
        return np.asarray([r["embedding"] for r in rows], dtype=np.float32)


class OpenAIProvider:
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else config.embedding_api_key()
        self.model = model or config.embedding_model()
        if not self.api_key:
            raise RuntimeError("EMBEDDING_API_KEY is required for openai")

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._embed(texts)

    def embed_query(self, text: str) -> np.ndarray:
        return self._embed([text])[0]

    def _embed(self, texts: list[str]) -> np.ndarray:
        data = _http_json(
            "https://api.openai.com/v1/embeddings",
            {"model": self.model, "input": texts},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        rows = data.get("data") or []
        rows = sorted(rows, key=lambda r: r["index"])
        return np.asarray([r["embedding"] for r in rows], dtype=np.float32)
