# indexer (Josh)

Walks a workspace of `.ts`/`.tsx` files and writes `files` / `nodes` / `edges`
per `contracts.md` (stable `path::name::type` ids, WAL, 1-indexed lines).

```sh
cmake -B build -S .   # first configure downloads tree-sitter (~1 min, needs network)
cmake --build build
./build/indexer <workspace_path> <db_path>
```

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

IMPORTS: relative paths resolved to `.ts`/`.tsx`/`index` files in the
workspace; bare packages and missing targets are dropped.

Next: `sample.db` from the contract mock graph.
