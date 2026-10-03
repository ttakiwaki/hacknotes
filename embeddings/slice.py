from __future__ import annotations

from pathlib import Path


def slice_symbol(
    workspace: str | Path,
    rel_path: str,
    start_line: int,
    end_line: int,
) -> str:
    """Return the node's source text using 1-indexed inclusive line ranges."""
    full = Path(workspace) / rel_path
    if not full.is_file():
        raise FileNotFoundError(f"workspace file not found: {full}")
    lines = full.read_text(encoding="utf-8").splitlines(keepends=True)
    if not lines:
        return ""
    start = max(1, start_line)
    end = min(len(lines), end_line)
    if end < start:
        return ""
    return "".join(lines[start - 1 : end])
