import { useEffect, useMemo, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import "@xyflow/react/dist/style.css";
import "./App.css";
import { ChatPanel } from "./components/ChatPanel";
import { GraphCanvas } from "./components/GraphCanvas";
import { PromptBar } from "./components/PromptBar";
import { SnippetDrawer } from "./components/SnippetDrawer";
import { mockEdges, mockNodes } from "./mocks/mockGraph";
import { useGraphStore } from "./store/useGraphStore";
import { GraphSocket } from "./ws/client";
import { THEMES, THEME_LABELS, repoName } from "./theme";

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
  const [isRepositoryLoading, setIsRepositoryLoading] = useState(false);
  const [repositoryLoadError, setRepositoryLoadError] = useState("");
  const [showDefines, setShowDefines] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("uxie-inspector-width"));
      if (Number.isFinite(saved)) return Math.min(640, Math.max(280, saved));
    } catch {
      // ignore
    }
    return 400;
  });
  // Per-field selectors: App must not re-render (and rebuild the graph)
  // when unrelated store slices change, e.g. every AI chat token.
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const impactedNodeIds = useGraphStore((s) => s.impactedNodeIds);
  const chatMessages = useGraphStore((s) => s.chatMessages);
  const isStreaming = useGraphStore((s) => s.isStreaming);
  const promptMessages = useGraphStore((s) => s.promptMessages);
  const isPromptStreaming = useGraphStore((s) => s.isPromptStreaming);
  const connectionStatus = useGraphStore((s) => s.connectionStatus);
  const error = useGraphStore((s) => s.error);
  const snippets = useGraphStore((s) => s.snippets);
  const theme = useGraphStore((s) => s.theme);
  const setTheme = useGraphStore((s) => s.setTheme);
  const setGraph = useGraphStore((s) => s.setGraph);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setImpactedNodeIds = useGraphStore((s) => s.setImpactedNodeIds);
  const setSnippet = useGraphStore((s) => s.setSnippet);
  const addUserMessage = useGraphStore((s) => s.addUserMessage);
  const startAssistantMessage = useGraphStore((s) => s.startAssistantMessage);
  const appendAssistantToken = useGraphStore((s) => s.appendAssistantToken);

  const socket = useMemo(() => new GraphSocket(), []);
  // Universal navigation: every symbol path site-wide rides here —
  // select it, fly the camera, and load its source.
  const navigateToNode = (id: string) => {
    selectNode(id);
    useGraphStore.getState().requestFocus(id);
    if (useMock) setSnippet(id, mockSnippet);
    else socket.send({ type: "nodeClicked", id });
  };

  // Prompt-bar thread: separate messages so inspector chat stays clean.
  // Either thread streaming blocks the other (one in-flight question).
  const handleAskPrompt = (trimmedQuestion: string, nodeId?: string) => {
    if (!trimmedQuestion || isStreaming || isPromptStreaming) return;
    const store = useGraphStore.getState();
    store.addPromptUserMessage(trimmedQuestion);
    store.startPromptAssistantMessage();
    if (useMock) {
      store.appendAssistantToken(
        "Mock backend: connect the server for embedding-backed project answers. Symbol matches still fly the camera.",
      );
      store.finishAssistantMessage();
    } else {
      socket.send({
        type: "askAI",
        question: trimmedQuestion,
        ...(nodeId ? { nodeId } : {}),
      });
    }
    // Guiding also opens the node: same ride as any site-wide path.
    if (nodeId) navigateToNode(nodeId);
  };
  const useMock = USE_MOCK;
  const repo = repoName(repositoryUrl);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedSnippet = selectedNodeId ? snippets[selectedNodeId] : undefined;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  // Memoized: without this, every parent render (e.g. each chat token)
  // rebuilds these arrays and React Flow reconciles the whole graph.
  const { visibleNodes, visibleEdges, searchMatch } = useMemo(() => {
    const matchingNodeIds = new Set(
      nodes
        .filter(
          (node) =>
            node.name.toLowerCase().includes(normalizedSearch) ||
            node.path.toLowerCase().includes(normalizedSearch),
        )
        .map((node) => node.id),
    );
    const visibleNodeIds = normalizedSearch
      ? new Set(matchingNodeIds)
      : new Set(nodes.map((node) => node.id));

    if (normalizedSearch) {
      const pending = [...matchingNodeIds];
      while (pending.length > 0) {
        const sourceId = pending.shift();
        if (!sourceId) continue;
        edges.forEach((edge) => {
          if (edge.source === sourceId && !visibleNodeIds.has(edge.target)) {
            visibleNodeIds.add(edge.target);
            pending.push(edge.target);
          }
        });
      }
    }

    const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    const visibleEdges = normalizedSearch
      ? edges.filter(
          (edge) =>
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
        )
      : edges;
    const searchMatch = normalizedSearch
      ? nodes.find(
          (node) =>
            node.name.toLowerCase().includes(normalizedSearch) ||
            node.path.toLowerCase().includes(normalizedSearch),
        )
      : undefined;
    return { visibleNodes, visibleEdges, searchMatch };
  }, [nodes, edges, normalizedSearch]);

  useEffect(() => {
    if (!hasStarted) return;
    if (useMock) {
      setGraph(mockNodes, mockEdges);
      return;
    }
    socket.connect(
      repositoryUrl.trim(),
      () => setIsRepositoryLoading(false),
      (message) => {
        setIsRepositoryLoading(false);
        setRepositoryLoadError(message);
      },
    );
    return () => socket.close();
  }, [hasStarted, repositoryUrl, setGraph, socket, useMock]);

  const handleRepositorySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repositoryUrl.trim()) return;
    setRepositoryLoadError("");
    setIsRepositoryLoading(!useMock);
    setHasStarted(true);
  };

  const handleHome = () => {
    selectNode(undefined);
    setImpactedNodeIds([]);
    setIsRepositoryLoading(false);
    setRepositoryLoadError("");
    setHasStarted(false);
  };

  const handleLandingPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty("--landing-graph-x", `${x * -32}px`);
    event.currentTarget.style.setProperty("--landing-graph-y", `${y * -32}px`);
  };

  const resetLandingPointer = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--landing-graph-x", "0px");
    event.currentTarget.style.setProperty("--landing-graph-y", "0px");
  };

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = (event.currentTarget as HTMLElement).parentElement;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const next = Math.min(640, Math.max(280, rect.right - event.clientX));
    setInspectorWidth(next);
    try {
      localStorage.setItem("uxie-inspector-width", String(Math.round(next)));
    } catch {
      // ignore
    }
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

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchMatch) handleNodeClick(searchMatch.id);
  };

  const handleAsk = (trimmedQuestion: string, nodeId?: string) => {
    if (!trimmedQuestion || isStreaming) return;
    addUserMessage(trimmedQuestion);
    startAssistantMessage();
    // Prefer the explicitly passed node (prompt bar already resolved and
    // selected it); the closure's selectedNodeId may still be stale.
    const targetId = nodeId ?? selectedNodeId;
    if (useMock) {
      setImpactedNodeIds([
        "src/api/users.ts::getUser::function",
        "src/api/users.ts::listUsers::function",
        "src/server.ts::startServer::function",
      ]);
      appendAssistantToken(
        "**Changing `DatabasePool`** affects these callers:\n\n- `getUser` and `listUsers` directly\n- `startServer` via `getUser`\n\n```ts\nawait pool.acquire()\n```\n",
      );
      useGraphStore.getState().finishAssistantMessage();
    } else {
      socket.send({
        type: "askAI",
        question: trimmedQuestion,
        ...(targetId ? { nodeId: targetId } : {}),
      });
    }
  };

  return (
    <main className="app-shell">
      {!hasStarted && (
        <section
          className="landing-page"
          aria-labelledby="landing-title"
          onPointerMove={handleLandingPointerMove}
          onPointerLeave={resetLandingPointer}
        >
          <div className="landing-graph-background" aria-hidden="true">
            <GraphCanvas
              nodes={mockNodes}
              edges={mockEdges}
              impactedNodeIds={[]}
              showDefines
              onNodeClick={() => undefined}
            />
          </div>
          <div className="landing-content">
            <svg
              className="landing-lockup"
              viewBox="30 20 510 216"
              role="img"
              aria-label="Uxie logo"
            >
              <g
                fill="none"
                stroke="currentColor"
                strokeWidth="24"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path
                  d="M68 60 V146 A60 60 0 0 0 188 146 V60"
                  strokeWidth="26"
                />
                <circle
                  cx="68"
                  cy="60"
                  r="22"
                  fill="currentColor"
                  stroke="none"
                />
                <circle
                  cx="188"
                  cy="60"
                  r="22"
                  fill="currentColor"
                  stroke="none"
                />
                <g transform="translate(126,213)">
                  <path d="M132 -120 L204 -8" transform="translate(-10 0)" />
                  <path d="M204 -120 L132 -8" transform="translate(-10 0)" />
                  <path d="M252 -120 V-6" />
                  <path
                    d="M373 -86 A44 44 0 1 0 373 -14"
                    transform="translate(4 0)"
                  />
                  <path d="M318 -50 H386" transform="translate(4 0)" />
                  <circle
                    cx="252"
                    cy="-162"
                    r="17"
                    fill="currentColor"
                    stroke="none"
                  />
                </g>
              </g>
            </svg>
            <h1 id="landing-title">See how your code fits together.</h1>
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
          </div>
        </section>
      )}
      {hasStarted && isRepositoryLoading && (
        <section
          className="repository-loading"
          role="status"
          aria-live="polite"
        >
          <h1>Preparing your codebase.</h1>
          <div className="loading-track" aria-hidden="true">
            <div className="loading-bar" />
          </div>
          <p>Cloning and indexing {repoName(repositoryUrl)}...</p>
          {repositoryLoadError && (
            <p className="landing-error">{repositoryLoadError}</p>
          )}
        </section>
      )}
      {hasStarted && !isRepositoryLoading && (
        <section
          className={`workspace ${selectedNodeId ? "has-inspector" : ""}`}
          style={
            selectedNodeId
              ? {
                  gridTemplateColumns: `minmax(0, 1fr) 8px ${inspectorWidth}px`,
                }
              : undefined
          }
        >
          <div className="graph-panel" id="graph">
            <div className="panel-heading">
              <div className="graph-brand">
                <svg
                  className="graph-mark"
                  viewBox="0 0 256 256"
                  role="img"
                  aria-label="Uxie logo"
                >
                  <path
                    d="M68 60 V146 A60 60 0 0 0 188 146 V60"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="26"
                    strokeLinecap="round"
                  />
                  <circle cx="68" cy="60" r="22" fill="currentColor" />
                  <circle cx="188" cy="60" r="22" fill="currentColor" />
                </svg>
                <div>
                  <p className="eyebrow">
                    {repo ? `${repo} / DEPENDENCY GRAPH` : "DEPENDENCY GRAPH"}
                  </p>
                  <h2>{nodes.length} symbols indexed</h2>
                </div>
              </div>
              <div className="graph-toolbar">
                <button
                  type="button"
                  className="pill-toggle"
                  onClick={handleHome}
                  title="Back to the start screen"
                >
                  ⌂ home
                </button>
                <select
                  className="pill-toggle theme-select"
                  value={theme}
                  onChange={(event) =>
                    setTheme(event.target.value as (typeof THEMES)[number])
                  }
                  aria-label="Color theme"
                  title="Color theme"
                >
                  {THEMES.map((t) => (
                    <option key={t} value={t}>
                      {THEME_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`pill-toggle ${showDefines ? "pill-on" : ""}`}
                  onClick={() => setShowDefines((v) => !v)}
                  aria-pressed={showDefines}
                  title="Show file-contains-symbol edges"
                >
                  defines
                </button>
                <form className="graph-search" onSubmit={handleSearchSubmit}>
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search files or symbols"
                    aria-label="Search files or symbols"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="clear-search"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </form>
                <span className={`status status-${connectionStatus}`}>
                  <span className="status-dot" />
                  {useMock ? "mock graph" : connectionStatus}
                </span>
                {!selectedNodeId && (
                  <span className="legend">click a node to inspect</span>
                )}
              </div>
            </div>
            <div className="graph-wrap">
              <PromptBar
                nodes={nodes}
                disabled={isStreaming || isPromptStreaming}
                streaming={isPromptStreaming}
                messages={promptMessages}
                onAsk={handleAskPrompt}
                onNavigate={navigateToNode}
              />
              <GraphCanvas
                nodes={visibleNodes}
                edges={visibleEdges}
                impactedNodeIds={impactedNodeIds}
                selectedNodeId={selectedNodeId}
                showDefines={showDefines}
                onNodeClick={handleNodeClick}
              />
            </div>
          </div>

          {selectedNodeId && (
            <div
              className="resize-handle"
              onPointerDown={(event) => {
                (event.target as HTMLElement).setPointerCapture(
                  event.pointerId,
                );
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) handleResizeMove(event);
              }}
              title="Drag to resize the inspector"
            />
          )}

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
              <SnippetDrawer
                node={selectedNode}
                code={selectedSnippet}
                nodes={nodes}
                onNavigate={navigateToNode}
              />
              <div id="debugger">
                <ChatPanel
                  messages={chatMessages}
                  nodes={nodes}
                  isStreaming={isStreaming || isPromptStreaming}
                  error={error?.message}
                  onAsk={handleAsk}
                  onNavigate={navigateToNode}
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
