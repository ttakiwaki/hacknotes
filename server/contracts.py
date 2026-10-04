from typing import Literal, Optional, Union
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class WireModel(BaseModel):
    """
    Base model enforcing camelCase key serialization on the wire
    while allowing snake_case attribute access in Python.
    """
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Literal Types ---
NodeType = Literal["function", "class", "file"]
EdgeType = Literal["CALLS", "IMPORTS", "INHERITS_FROM", "DEFINES"]
ErrorCode = Literal[
    "SYMBOL_NOT_FOUND", "LLM_ERROR", "DB_ERROR", "BAD_REQUEST", "INTERNAL"
]


# --- Core Graph Structures ---
class GraphNode(WireModel):
    id: str
    type: NodeType
    name: str
    path: str
    start_line: int
    end_line: int


class GraphEdge(WireModel):
    source: str
    target: str
    type: EdgeType


# --- Server -> Client Messages (Ben -> Cameron) ---
class GraphData(WireModel):
    type: Literal["graphData"] = "graphData"
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class HighlightNodes(WireModel):
    type: Literal["highlightNodes"] = "highlightNodes"
    ids: list[str]


class ChatToken(WireModel):
    type: Literal["chatToken"] = "chatToken"
    text: str


class ChatDone(WireModel):
    type: Literal["chatDone"] = "chatDone"


class NodeSnippet(WireModel):
    type: Literal["nodeSnippet"] = "nodeSnippet"
    id: str
    code: str


class ErrorMessage(WireModel):
    type: Literal["error"] = "error"
    code: ErrorCode
    message: str


# --- Client -> Server Messages (Cameron -> Ben) ---
class LoadRepository(WireModel):
    type: Literal["loadRepository"]
    repository_url: str


class AskAI(WireModel):
    type: Literal["askAI"] = "askAI"
    question: str
    node_id: Optional[str] = None


class NodeClicked(WireModel):
    type: Literal["nodeClicked"] = "nodeClicked"
    id: str


# --- Discriminated Union Types ---
ServerMessage = Union[
    GraphData, HighlightNodes, ChatToken, ChatDone, NodeSnippet, ErrorMessage
]
ClientMessage = Union[LoadRepository, AskAI, NodeClicked]