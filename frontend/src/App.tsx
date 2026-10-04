import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "@xyflow/react/dist/style.css";
import "./App.css";
import { ChatPanel } from "./components/ChatPanel";
import { GraphCanvas } from "./components/GraphCanvas";
import { SnippetDrawer } from "./components/SnippetDrawer";
import { mockEdges, mockNodes } from "./mocks/mockGraph";
import { useGraphStore } from "./store/useGraphStore";
import { GraphSocket } from "./ws/client";

const mockSnippet = `export class DatabasePoolaaaaaaaaaaaaaaaaaa {
  constructor(private readonly size = 10) {}

  async acquire() {
    return this.connectionPool.acquireeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee()
  }
  a
  a
  a
  a
  a
  a
  a
  a
  a
  a
  a
  a
  a
}`;

// Set to false to use the FastAPI/WebSocket backend.
const USE_MOCK = false;

function App() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
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
  } = useGraphStore();

  const socket = useMemo(() => new GraphSocket(), []);
  const useMock = USE_MOCK;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedSnippet = selectedNodeId ? snippets[selectedNodeId] : undefined;

  useEffect(() => {
    if (!hasStarted) return;
    if (useMock) {
      setGraph(mockNodes, mockEdges);
      return;
    }
    socket.connect(repositoryUrl.trim());
    return () => socket.close();
  }, [hasStarted, setGraph, socket, useMock]);

  const handleRepositorySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repositoryUrl.trim()) return;
    setHasStarted(true);
  };

  const handleNodeClick = (id: string) => {
    selectNode(id);
    const dependents = new Set<string>();
    const frontier = new Set([id]);
    for (let depth = 0; depth < 2; depth += 1) {
      const next = new Set<string>();
      edges.forEach((edge) => {
        if (
          frontier.has(edge.target) &&
          ["CALLS", "INHERITS_FROM"].includes(edge.type)
        ) {
          dependents.add(edge.source);
          next.add(edge.source);
        }
      });
      frontier.clear();
      next.forEach((nodeId) => frontier.add(nodeId));
    }
    setImpactedNodeIds([...dependents]);
    if (useMock) setSnippet(id, mockSnippet);
    else socket.send({ type: "nodeClicked", id });
  };

  const handleAsk = (trimmedQuestion: string) => {
    if (!trimmedQuestion || isStreaming) return;
    addUserMessage(trimmedQuestion);
    startAssistantMessage();
    if (useMock) {
      setImpactedNodeIds([
        "src/api/users.ts::getUser::function",
        "src/api/users.ts::listUsers::function",
        "src/server.ts::startServer::function",
      ]);
      appendAssistantToken(
        "Changing DatabasePool affects getUser and listUsers directly. startServer depends on getUser, so it is also in the impact path.",
      );
      useGraphStore.getState().finishAssistantMessage();
    } else {
      socket.send({
        type: "askAI",
        question: trimmedQuestion,
        ...(selectedNodeId ? { nodeId: selectedNodeId } : {}),
      });
    }
  };

  return (
    <main className="app-shell">
      {!hasStarted && (
        <section className="landing-page" aria-labelledby="landing-title">
          <div className="landing-mark">⌁</div>
          <p className="eyebrow">HACKNOTES / CODEBASE MAP</p>
          <h1 id="landing-title">See how your code fits together.</h1>
          <p className="landing-description">
            Paste a GitHub repository and explore its dependencies, source, and
            change impact in one place.
          </p>
          <form className="repository-form" onSubmit={handleRepositorySubmit}>
            <input
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              aria-label="GitHub repository URL"
              autoFocus
            />
            <button type="submit">Explore repository</button>
          </form>
          <span className="landing-note">
            Local-first. No account required.
          </span>
        </section>
      )}
      {hasStarted && (
        <section
          className={`workspace ${selectedNodeId ? "has-inspector" : ""}`}
        >
          <div className="graph-panel" id="graph">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DEPENDENCY GRAPH</p>
                <h2>{nodes.length} symbols indexed</h2>
              </div>
              <div className="graph-toolbar">
                <span className={`status status-${connectionStatus}`}>
                  <span className="status-dot" />
                  {useMock ? "mock graph" : connectionStatus}
                </span>
                {!selectedNodeId && (
                  <span className="legend">click a node to inspect</span>
                )}
              </div>
            </div>
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              impactedNodeIds={impactedNodeIds}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
            />
          </div>

          {selectedNodeId && (
            <aside className="detail-panel" id="inspector">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">INSPECTOR</p>
                  <h2>Selected symbol</h2>
                </div>
                <button
                  className="close-inspector"
                  type="button"
                  onClick={() => selectNode(undefined)}
                  aria-label="Close inspector"
                >
                  ×
                </button>
              </div>
              <SnippetDrawer node={selectedNode} code={selectedSnippet} />
              <div id="debugger">
                <ChatPanel
                  messages={chatMessages}
                  nodes={nodes}
                  isStreaming={isStreaming}
                  error={error?.message}
                  onAsk={handleAsk}
                />
              </div>
            </aside>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
