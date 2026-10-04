import type { ClientMessage, ServerMessage } from '../types/contracts'
import { useGraphStore } from '../store/useGraphStore'

const reconnectDelayMs = 1500

export class GraphSocket {
  private socket?: WebSocket
  private reconnectTimer?: number
  private closedByUser = false

  connect(repositoryUrl?: string) {
    this.closedByUser = false
    this.open(repositoryUrl)
  }

  close() {
    this.closedByUser = true
    window.clearTimeout(this.reconnectTimer)
    this.socket?.close()
    this.socket = undefined
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  private open(repositoryUrl?: string) {
    const url = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws'
    useGraphStore.getState().setConnectionStatus('connecting')
    this.socket = new WebSocket(url)

    this.socket.addEventListener('open', () => {
      useGraphStore.getState().setConnectionStatus('connected')
      if (repositoryUrl) {
        this.send({ type: 'loadRepository', repositoryUrl })
      }
    })
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(JSON.parse(event.data) as ServerMessage)
    })
    this.socket.addEventListener('close', () => {
      useGraphStore.getState().setConnectionStatus('disconnected')
      if (!this.closedByUser) {
        this.reconnectTimer = window.setTimeout(
          () => this.open(repositoryUrl),
          reconnectDelayMs,
        )
      }
    })
    this.socket.addEventListener('error', () => {
      useGraphStore.getState().setConnectionStatus('disconnected')
    })
  }

  private handleMessage(message: ServerMessage) {
    const store = useGraphStore.getState()
    switch (message.type) {
      case 'graphData':
        store.setGraph(message.nodes, message.edges)
        break
      case 'highlightNodes':
        store.setImpactedNodeIds(message.ids)
        break
      case 'chatToken':
        store.appendAssistantToken(message.text)
        break
      case 'chatDone':
        store.finishAssistantMessage()
        break
      case 'nodeSnippet':
        store.setSnippet(message.id, message.code)
        break
      case 'error':
        store.setError({ code: message.code, message: message.message })
        break
    }
  }
}
