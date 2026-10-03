from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from embeddings.index import index_embeddings
from embeddings.search import search_symbols
from embeddings.seed_sample import seed_sample


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        prog="python -m embeddings",
        description="Index symbol embeddings and run semantic search.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_index = sub.add_parser("index", help="embed new/changed nodes into SQLite")
    p_index.add_argument("--db", dest="db_path", default=None)
    p_index.add_argument("--workspace", dest="workspace", default=None)

    p_search = sub.add_parser("search", help="query search_symbols")
    p_search.add_argument("query")
    p_search.add_argument("-k", type=int, default=5)
    p_search.add_argument("--db", dest="db_path", default=None)

    p_seed = sub.add_parser(
        "seed",
        help="write the CONTRACTS.md mock workspace + SQLite (hour-one fake nodes)",
    )
    p_seed.add_argument(
        "--db",
        dest="db_path",
        default=str(Path("embeddings/dev/sample.db")),
    )
    p_seed.add_argument(
        "--workspace",
        dest="workspace",
        default=str(Path("embeddings/dev/sample_workspace")),
    )

    args = parser.parse_args(argv)

    if args.cmd == "index":
        stats = index_embeddings(db_path=args.db_path, workspace=args.workspace)
        print(json.dumps(stats, indent=2))
        return 0
    if args.cmd == "search":
        hits = search_symbols(args.query, args.k, db_path=args.db_path)
        print(json.dumps(hits, indent=2))
        return 0
    if args.cmd == "seed":
        out = seed_sample(Path(args.db_path), Path(args.workspace))
        print(json.dumps(out, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
