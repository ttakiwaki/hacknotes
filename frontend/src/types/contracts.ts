export type NodeType = 'function' | 'class' | 'file'
export type EdgeType = 'CALLS' | 'IMPORTS' | 'INHERITS_FROM' | 'DEFINES'

export interface GraphNode {
  id: string
  type: NodeType
  name: string
  path: string
  startLine: number
  endLine: number
}

export interface GraphEdge {
  source: string
  target: string
  type: EdgeType
}

export type ErrorCode =
  | 'SYMBOL_NOT_FOUND'
  | 'LLM_ERROR'
  | 'DB_ERROR'
  | 'BAD_REQUEST'
  | 'INTERNAL'

export type ServerMessage =
  | { type: 'graphData'; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'highlightNodes'; ids: string[] }
  | { type: 'chatToken'; text: string }
  | { type: 'chatDone' }
  | { type: 'nodeSnippet'; id: string; code: string }
  | { type: 'error'; code: ErrorCode; message: string }

export type ClientMessage =
  | { type: 'loadRepository'; repositoryUrl: string }
  | { type: 'askAI'; question: string; nodeId?: string }
  | { type: 'nodeClicked'; id: string }
