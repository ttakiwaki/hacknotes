import { create } from 'zustand'
import type {
  ErrorCode,
  GraphEdge,
  GraphNode,
} from '../types/contracts'
import { loadTheme, type ThemeName } from '../theme'

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
  // Separate prompt-bar thread: its Q&A must not leak into the inspector
  // chat. streamThread routes streamed tokens to the active thread.
  promptMessages: ChatMessage[]
  isPromptStreaming: boolean
  streamThread: 'chat' | 'prompt' | null
  addPromptUserMessage: (text: string) => void
  startPromptAssistantMessage: () => void
  connectionStatus: ConnectionStatus
  error?: { code: ErrorCode; message: string }
  theme: ThemeName
  // Camera focus request (e.g. from the prompt bar). GraphCanvas consumes
  // `focusNonce` and flies to `focusNodeId`; selection state is separate.
  focusNodeId?: string
  focusNonce: number
  requestFocus: (id: string) => void
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
  setTheme: (theme: ThemeName) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  impactedNodeIds: [],
  snippets: {},
  chatMessages: [],
  isStreaming: false,
  promptMessages: [],
  isPromptStreaming: false,
  streamThread: null,
  connectionStatus: 'disconnected',
  theme: loadTheme(),
  focusNonce: 0,
  requestFocus: (focusNodeId) =>
    set((state) => ({ focusNodeId, focusNonce: state.focusNonce + 1 })),
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
      streamThread: 'chat',
    })),
  addPromptUserMessage: (text) =>
    set((state) => ({
      promptMessages: [...state.promptMessages, { role: 'user', text }],
    })),
  startPromptAssistantMessage: () =>
    set((state) => ({
      promptMessages: [...state.promptMessages, { role: 'assistant', text: '' }],
      isPromptStreaming: true,
      error: undefined,
      streamThread: 'prompt',
    })),
  appendAssistantToken: (text) =>
    set((state) => {
      if (state.streamThread === 'prompt') {
        const messages = [...state.promptMessages]
        const last = messages.at(-1)
        if (!last || last.role !== 'assistant') return state
        messages[messages.length - 1] = { ...last, text: last.text + text }
        return { promptMessages: messages }
      }
      const messages = [...state.chatMessages]
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return state
      messages[messages.length - 1] = { ...last, text: last.text + text }
      return { chatMessages: messages }
    }),
  finishAssistantMessage: () =>
    set({ isStreaming: false, isPromptStreaming: false, streamThread: null }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setError: (error) =>
    set({
      error,
      isStreaming: false,
      isPromptStreaming: false,
      streamThread: null,
    }),
  setTheme: (theme) => {
    try {
      localStorage.setItem('uxie-theme', theme)
    } catch {
      // ignore (private mode)
    }
    set({ theme })
  },
}))
