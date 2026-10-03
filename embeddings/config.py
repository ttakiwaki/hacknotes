from __future__ import annotations

import os
from pathlib import Path

from embeddings.dotenv_load import load_env

load_env()

REPO_ROOT = Path(__file__).resolve().parent.parent


def db_path() -> Path:
    return Path(os.environ.get("DB_PATH", "./index.db")).expanduser().resolve()


def workspace_path() -> Path:
    raw = os.environ.get("WORKSPACE_PATH")
    if not raw:
        raise RuntimeError(
            "WORKSPACE_PATH is not set. Point it at the repo being visualized "
            "(the folder Josh indexed)."
        )
    return Path(raw).expanduser().resolve()


def embedding_provider_name() -> str:
    return os.environ.get("EMBEDDING_PROVIDER", "ollama").strip().lower()


def embedding_model() -> str:
    return os.environ.get("EMBEDDING_MODEL", "nomic-embed-text").strip()


def embedding_api_key() -> str:
    return os.environ.get("EMBEDDING_API_KEY", "").strip()


def ollama_host() -> str:
    return os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")


def embedding_batch_size() -> int:
    return int(os.environ.get("EMBEDDING_BATCH_SIZE", "32"))
