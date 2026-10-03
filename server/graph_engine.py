import os
import sqlite3
import networkx as nx
from typing import Optional, List, Tuple

from server.contracts import GraphNode, GraphEdge


class GraphEngine:
    def __init__(self, db_path: str, workspace_path: str):
        self.db_path = db_path
        self.workspace_path = workspace_path
        self.graph = nx.DiGraph()
        self.nodes_dict: dict[str, GraphNode] = {}
        self.edges_list: list[GraphEdge] = []

    def load_from_db(self):
        """Reads SQLite tables in WAL mode and builds the NetworkX graph."""
        if not os.path.exists(self.db_path):
            print(f"Warning: DB file '{self.db_path}' not found. Initializing empty graph.")
            return

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Ensure WAL mode
        cursor.execute("PRAGMA journal_mode=WAL;")

        # Fetch nodes
        cursor.execute("SELECT id, type, name, path, start_line, end_line FROM nodes")
        self.nodes_dict.clear()
        for row in cursor.fetchall():
            node = GraphNode(
                id=row["id"],
                type=row["type"],
                name=row["name"],
                path=row["path"],
                start_line=row["start_line"],
                end_line=row["end_line"],
            )
            self.nodes_dict[node.id] = node
            self.graph.add_node(node.id, **node.model_dump())

        # Fetch edges
        cursor.execute("SELECT source_id, target_id, type FROM edges")
        self.edges_list.clear()
        for row in cursor.fetchall():
            edge = GraphEdge(
                source=row["source_id"],
                target=row["target_id"],
                type=row["type"],
            )
            self.edges_list.append(edge)
            self.graph.add_edge(edge.source, edge.target, type=edge.type)

        conn.close()
        print(f"Loaded {len(self.nodes_dict)} nodes and {len(self.edges_list)} edges into NetworkX.")

    def get_impacted_nodes(self, target_id: str, max_depth: int = 2) -> list[str]:
        """
        Calculates impact set via depth-2 reverse BFS over CALLS and INHERITS_FROM edges.
        'What breaks if I change X?' -> nodes pointing INTO target_id.
        """
        if target_id not in self.graph:
            return []

        # Subgraph with relevant dependency edges only
        rel_edges = [
            (u, v) for u, v, d in self.graph.edges(data=True)
            if d.get("type") in ("CALLS", "INHERITS_FROM")
        ]
        dep_graph = nx.DiGraph(rel_edges)

        if target_id not in dep_graph:
            return []

        # Reverse traversal: find predecessors up to max_depth
        impacted = set()
        current_layer = {target_id}

        for _ in range(max_depth):
            next_layer = set()
            for node in current_layer:
                predecessors = set(dep_graph.predecessors(node))
                next_layer.update(predecessors)
            
            # Exclude original target from results
            next_layer.discard(target_id)
            if not next_layer:
                break
            impacted.update(next_layer)
            current_layer = next_layer

        return list(impacted)

    def get_snippet(self, node_id: str) -> Optional[str]:
        """Slices target code from file by 1-indexed inclusive line numbers."""
        node = self.nodes_dict.get(node_id)
        if not node:
            return None

        full_path = os.path.join(self.workspace_path, node.path)
        if not os.path.exists(full_path):
            return f"// Source file not found: {node.path}"

        try:
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            # 1-indexed inclusive slicing
            start = max(1, node.start_line) - 1
            end = min(len(lines), node.end_line)
            return "".join(lines[start:end])
        except Exception as e:
            return f"// Error reading snippet: {str(e)}"