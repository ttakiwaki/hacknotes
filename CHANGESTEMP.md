# CHANGES.md

Append-only log of **every change, big or small**, across the whole project. Defined by `super.md` (Section 0, rule 8).

**Rules**

1. One row per change set. Nothing is too small to log.
2. Add new rows at the **bottom**. Never rewrite, reorder or delete old rows; if a row was wrong, add a new correcting row.
3. This file changes only through a PR to `main` (webmaster merges, may batch rows from several people). Teammates send their rows to the webmaster instead of editing this file on their own branch.
4. `Contract impact` is `none`, or names which contract changed (SQLite schema / `search_symbols` / WebSocket / conventions). A contract change also needs an edit to `CONTRACTS.md` and a row in its change log.
5. `Area` is one of: `indexer`, `embeddings`, `server`, `ui`, `contracts`, `docs`, `config`, `other`.

| Date | Who / branch | Area | What changed | Why | Files touched | Contract impact |
| ---- | ------------ | ---- | ------------ | --- | ------------- | --------------- |
