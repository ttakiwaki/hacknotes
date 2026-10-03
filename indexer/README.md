# indexer (Josh)

MVP0: builds one binary that creates a valid SQLite DB with dummy rows.

```sh
cmake -B build -S .
cmake --build build
./build/indexer <workspace_path> <db_path>
```

Check the output:

```sh
sqlite3 <db_path> "SELECT * FROM nodes;"
```

Next: walker (`node_modules/.git/dist` skip + SHA-256) then tree-sitter TSX parsing in `src/parse.cpp`.
