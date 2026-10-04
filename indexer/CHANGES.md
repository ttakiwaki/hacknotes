# indexer (Josh)

Walks a workspace of `.ts`/`.tsx`/`.js`/`.jsx`/`.py`/`.html`/`.css`
files and writes
`files` / `nodes` / `edges` per `CONTRACTS.md` (stable `path::name::type`
ids, WAL, 1-indexed lines).

```sh
cmake -B build -S .   # first configure downloads tree-sitter (~1 min, needs network)
cmake --build build
./build/indexer [options] <workspace_path|git_url> <db_path>
./build/indexer --help      # all flags: --db, --full, --clean, --queries,
                            # -q/--quiet, -v/--verbose, --version
```

A `https://`, `git@`, or `ssh://` arg is shallow-cloned to a temp dir and
indexed from there (private repos work when `git` itself can auth); the
clone is deleted afterwards. Plain `indexer WS DB` still works, so existing
scripts keep running. Exit codes: 0 ok, 1 runtime error, 2 bad usage.

Check the output:

```sh
sqlite3 <db_path> "SELECT id,start_line,end_line FROM nodes WHERE type!='file';"
```

Pipeline per run: schema (+PK/indexes) → walker (skip
`node_modules/.git/dist`, SHA-256, file nodes, reindex delete) → parser
(tree-sitter TS/TSX, `queries/tsx.scm`, symbol nodes + `DEFINES` edges).

Collision rule: first symbol keeps the clean id, later same-name same-file
symbols get `#<start_line>`.

CALLS resolution: same-file definition wins, else a unique repo-wide
definition, else skipped as ambiguous; calls to unknown names are dropped
(no dangling edges). Top-level calls have no function caller and are skipped.

IMPORTS: relative paths resolved against the files table (script,
markup, and style extensions plus `index` files); bare packages, remote
URLs, and missing targets are dropped.

Languages: `.ts`/`.tsx` (tree-sitter-typescript), `.js`/`.jsx`
(tree-sitter-javascript, same query layout as TS), `.py`
(tree-sitter-python: `def`/`class`/named `lambda`, `from`/`import` with
dotted-name resolution to `.py`/`__init__.py`), `.html`/`.css`
(file nodes + IMPORTS only: `href`/`src` attributes, CSS `@import`/`url()`;
no new symbol kinds, so no contract change). One query file per family
(`tsx.scm`, `js.scm`, `py.scm`, `html.scm`, `css.scm`); pattern indices
are per-file. Note: this tree-sitter build does not evaluate `#eq?` /
`#match?` text predicates (verified empirically), so attribute filtering
(`href` vs `rel`, `url()`) happens in C++ via `@imp.key` captures.

`sample-workspace/` is the contract mock (pool/users/server) with exact
line numbers. Regenerate the root `sample.db` with:
`./build/indexer sample-workspace ../sample.db`

Incremental: files whose SHA-256 matches `files.hash` are skipped
(no-op reruns skip parsing entirely); deleted files are purged with their
nodes and touching edges. A change in any file triggers a full reparse so
CALLS stay consistent (no stale incoming edges after renames).

Next: PR to `main`.
