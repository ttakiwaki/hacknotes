import { useEffect, useMemo } from 'react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { ChatPanel } from './components/ChatPanel'
import { GraphCanvas } from './components/GraphCanvas'
import { SnippetDrawer } from './components/SnippetDrawer'
import { mockEdges, mockNodes } from './mocks/mockGraph'
import { useGraphStore } from './store/useGraphStore'
import { GraphSocket } from './ws/client'

const mockSnippet = `export class DatabasePool {
  constructor(private readonly size = 10) {}

  async acquire() {
    return this.connectionPool.acquire()
  }
}`

function App() {
  const {
    nodes,
    edges,
    selectedNodeId,
    impactedNodeIds,
    chatMessages,
    isStreaming,
    connectionStatus,
    error,
    snippets,
    setGraph,
    selectNode,
    setImpactedNodeIds,
    setSnippet,
    addUserMessage,
    startAssistantMessage,
    appendAssistantToken,
  } = useGraphStore()

  const socket = useMemo(() => new GraphSocket(), [])
  const useMock = import.meta.env.VITE_USE_MOCK !== 'false'
  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
  const selectedSnippet = selectedNodeId ? snippets[selectedNodeId] : undefined

  useEffect(() => {
    if (useMock) {
      setGraph(mockNodes, mockEdges)
      return
    }
    socket.connect()
    return () => socket.close()
  }, [setGraph, socket, useMock])

  const handleNodeClick = (id: string) => {
    selectNode(id)
    const dependents = new Set<string>()
    const frontier = new Set([id])
    for (let depth = 0; depth < 2; depth += 1) {
      const next = new Set<string>()
      edges.forEach((edge) => {
        if (frontier.has(edge.target) && ['CALLS', 'INHERITS_FROM'].includes(edge.type)) {
          dependents.add(edge.source)
          next.add(edge.source)
        }
      })
      frontier.clear()
      next.forEach((nodeId) => frontier.add(nodeId))
    }
    setImpactedNodeIds([...dependents])
    if (useMock) setSnippet(id, mockSnippet)
    else socket.send({ type: 'nodeClicked', id })
  }

  const handleAsk = (trimmedQuestion: string) => {
    if (!trimmedQuestion || isStreaming) return
    addUserMessage(trimmedQuestion)
    startAssistantMessage()
    if (useMock) {
      setImpactedNodeIds([
        'src/api/users.ts::getUser::function',
        'src/api/users.ts::listUsers::function',
        'src/server.ts::startServer::function',
      ])
      appendAssistantToken(
        'Changing DatabasePool affects getUser and listUsers directly. startServer depends on getUser, so it is also in the impact path.',
      )
      useGraphStore.getState().finishAssistantMessage()
    } else {
      socket.send({
        type: 'askAI',
        question: trimmedQuestion,
        ...(selectedNodeId ? { nodeId: selectedNodeId } : {}),
      })
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">HACKNOTES / CODEBASE MAP</p>
          <h1>Understand the blast radius.</h1>
        </div>
        <span className={`status status-${connectionStatus}`}>
          <span className="status-dot" />
          {useMock ? 'mock graph' : connectionStatus}
        </span>
      </header>

      <section className="workspace">
        <div className="graph-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DEPENDENCY GRAPH</p>
              <h2>{nodes.length} symbols indexed</h2>
            </div>
            <span className="legend">click a node to inspect</span>
          </div>
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            impactedNodeIds={impactedNodeIds}
            selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick}
          />
        </div>

        <aside className="detail-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INSPECTOR</p>
              <h2>{selectedNodeId ? 'Selected symbol' : 'Select a symbol'}</h2>
            </div>
          </div>
          <SnippetDrawer node={selectedNode} code={selectedSnippet} />
          <ChatPanel
            messages={chatMessages}
            nodes={nodes}
            isStreaming={isStreaming}
            error={error?.message}
            onAsk={handleAsk}
          />
        </aside>
      </section>
    </main>
  )
}

export default App
