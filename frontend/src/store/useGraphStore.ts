import { create } from 'zustand'
import type {
  ErrorCode,
  GraphEdge,
  GraphNode,
} from '../types/contracts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId?: string
  impactedNodeIds: string[]
  snippets: Record<string, string>
  chatMessages: ChatMessage[]
  isStreaming: boolean
  connectionStatus: ConnectionStatus
  error?: { code: ErrorCode; message: string }
  setGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void
  selectNode: (id?: string) => void
  setImpactedNodeIds: (ids: string[]) => void
  setSnippet: (id: string, code: string) => void
  addUserMessage: (text: string) => void
  startAssistantMessage: () => void
  appendAssistantToken: (text: string) => void
  finishAssistantMessage: () => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setError: (error?: { code: ErrorCode; message: string }) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  impactedNodeIds: [],
  snippets: {},
  chatMessages: [],
  isStreaming: false,
  connectionStatus: 'disconnected',
  setGraph: (nodes, edges) => set({ nodes, edges }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setImpactedNodeIds: (impactedNodeIds) => set({ impactedNodeIds }),
  setSnippet: (id, code) =>
    set((state) => ({ snippets: { ...state.snippets, [id]: code } })),
  addUserMessage: (text) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, { role: 'user', text }],
    })),
  startAssistantMessage: () =>
    set((state) => ({
      chatMessages: [...state.chatMessages, { role: 'assistant', text: '' }],
      isStreaming: true,
      error: undefined,
    })),
  appendAssistantToken: (text) =>
    set((state) => {
      const messages = [...state.chatMessages]
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return state
      messages[messages.length - 1] = { ...last, text: last.text + text }
      return { chatMessages: messages }
    }),
  finishAssistantMessage: () => set({ isStreaming: false }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setError: (error) => set({ error, isStreaming: false }),
}))
