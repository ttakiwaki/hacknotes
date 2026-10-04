import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { GraphEdge, GraphNode } from "../types/contracts";
import { GRAPH_COLORS } from "../theme";
import { useGraphStore } from "../store/useGraphStore";

interface CodeNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  impacted: boolean;
  selected: boolean;
  dimmed: boolean;
}

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  impactedNodeIds: string[];
  selectedNodeId?: string;
  showDefines: boolean;
  onNodeClick: (id: string) => void;
}

// Edge look per relationship type. DEFINES (file contains symbol) is
// structural and numerous, so it stays thin, dashed, and label-free;
// CALLS/IMPORTS carry the signal and get color + labels.
function edgeStyle(type: string, theme: keyof typeof GRAPH_COLORS) {
  const c = GRAPH_COLORS[theme];
  switch (type) {
    case "CALLS":
      return { stroke: c.calls, strokeWidth: 2 };
    case "IMPORTS":
      return { stroke: c.imports, strokeWidth: 2 };
    default:
      return { stroke: c.defines, strokeWidth: 1.25, strokeDasharray: "4 3" };
  }
}

const elk = new ELK();
const nodeWidth = 190;
const nodeHeight = 88;

function minimapColor(theme: keyof typeof GRAPH_COLORS) {
  const c = GRAPH_COLORS[theme];
  return (node: Node) => {
    const g = (node.data as CodeNodeData | undefined)?.graphNode;
    if (g?.type === "file") {
      const ext = (g.path.split(".").pop() ?? "").toLowerCase();
      if (ext === "html") return c.fileHtml;
      if (ext === "css") return c.fileCss;
      return c.file;
    }
    if (g?.type === "class") return c.class;
    return c.function;
  };
}

function CodeNode({ data }: NodeProps<Node<CodeNodeData>>) {
  const { graphNode, impacted, selected, dimmed } = data;
  const ext =
    graphNode.type === "file"
      ? (graphNode.path.split(".").pop() ?? "").toLowerCase()
      : "";
  const extClass =
    ext === "html" || ext === "css" ? ` node-ext-${ext}` : "";
  return (
    <div
      className={`flow-node node-${graphNode.type}${extClass} ${
        impacted ? "flow-node-impacted" : ""
      } ${selected ? "flow-node-selected" : ""} ${
        dimmed ? "flow-node-dimmed" : ""
      }`}
    >
      <Handle className="flow-handle" position={Position.Left} type="target" />
      <span className="node-type">{graphNode.type}</span>
      <strong title={graphNode.name}>{graphNode.name}</strong>
      <small title={graphNode.path}>{graphNode.path}</small>
      <Handle className="flow-handle" position={Position.Right} type="source" />
    </div>
  );
}

const nodeTypes = { code: CodeNode };

// Curvy edge with per-edge curvature. Parallel edges (same endpoints)
// would draw as one stacked line, so each edge gets a deterministic
// bend from its index that fans them apart. Colors still come from
// the `style` prop set in flowEdges (CALLS orange, IMPORTS blue,
// DEFINES gray dashed).
function CurvyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  label,
  data,
}: EdgeProps<Edge<{ bend?: number }>>) {
  const bend = data?.bend ?? 0;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.3 + bend,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label != null && (
        <EdgeLabelRenderer>
          <div
            className="edge-tag"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { curvy: CurvyEdge };

async function layoutGraph(
  nodes: Node<CodeNodeData>[],
  edges: Edge[],
): Promise<Node<CodeNodeData>[]> {
  const layout = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "55",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "20",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.semiInteractive": "true",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positions = new Map(
    (layout.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  );
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }));
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Pan momentum: track viewport velocity while the user drags, then keep
// gliding with friction after release. Wheel/programmatic moves never
// record samples, so zooming can't trigger or disturb a glide.
function useGlide() {
  const { setViewport } = useReactFlow();
  const frame = useRef<number | null>(null);
  const samples = useRef<{ x: number; y: number; t: number }[]>([]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const cancel = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };

  const onMoveStart = () => {
    cancel();
    samples.current = [];
  };

  const onMove = (event: unknown, vp: Viewport) => {
    if (
      event == null ||
      (event as Event).type === "wheel" ||
      frame.current != null
    )
      return;
    const s = samples.current;
    s.push({ x: vp.x, y: vp.y, t: performance.now() });
    if (s.length > 8) s.shift();
  };

  const onMoveEnd = (event: unknown, vp: Viewport) => {
    if (event == null || (event as Event).type === "wheel") return;
    const s = samples.current;
    if (s.length < 2) return;
    const first = s[0];
    const last = s[s.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < 120) return;
    const cap = 3000;
    const k = Math.min(1, cap / speed);
    vx *= k;
    vy *= k;
    let x = vp.x;
    let y = vp.y;
    const zoom = vp.zoom;
    let prev = performance.now();
    const step = (now: number) => {
      const d = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const friction = Math.pow(0.02, d);
      x += vx * d;
      y += vy * d;
      vx *= friction;
      vy *= friction;
      setViewport({ x, y, zoom });
      if (Math.hypot(vx, vy) > 25) {
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = null;
      }
    };
    frame.current = requestAnimationFrame(step);
  };

  return { onMoveStart, onMove, onMoveEnd };
}

function GraphCanvasInner({
  nodes,
  edges,
  impactedNodeIds,
  selectedNodeId,
  showDefines,
  onNodeClick,
}: GraphCanvasProps) {
  const [layoutedNodes, setLayoutedNodes] = useState<Node<CodeNodeData>[]>([]);
  const glide = useGlide();
  const { setCenter } = useReactFlow();
  const theme = useGraphStore((s) => s.theme);
  const mapColor = useMemo(() => minimapColor(theme), [theme]);
  // Layout always sees the full edge set so toggling DEFINES on/off
  // doesn't reshuffle node positions; only rendering is filtered.
  const layoutEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => ({
        id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
        source: edge.source,
        target: edge.target,
      })),
    [edges],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges
        .filter((edge) => showDefines || edge.type !== "DEFINES")
        .map((edge, index) => ({
          id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
          source: edge.source,
          target: edge.target,
          type: "curvy",
          animated: edge.type === "CALLS",
          label: edge.type === "DEFINES" ? undefined : edge.type,
          style: {
            ...edgeStyle(edge.type, theme),
            opacity:
              selectedNodeId &&
              edge.source !== selectedNodeId &&
              edge.target !== selectedNodeId
                ? 0.18
                : 1,
          },
          data: { bend: ((index % 5) - 2) * 0.22 },
          className: `flow-edge edge-${edge.type.toLowerCase()}`,
        })),
    [edges, selectedNodeId, showDefines, theme],
  );

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set([selectedNodeId]);
    edges.forEach((edge) => {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    });
    return ids;
  }, [edges, selectedNodeId]);

  useEffect(() => {
    let cancelled = false;
    const baseNodes: Node<CodeNodeData>[] = nodes.map((graphNode) => ({
      id: graphNode.id,
      type: "code",
      position: { x: 0, y: 0 },
      // Explicit dimensions match the rendered node dimensions.
      width: nodeWidth,
      height: nodeHeight,
      data: {
        graphNode,
        impacted: impactedNodeIds.includes(graphNode.id),
        selected: selectedNodeId === graphNode.id,
        dimmed:
          selectedNodeId !== undefined && !connectedNodeIds.has(graphNode.id),
      },
    }));

    void layoutGraph(baseNodes, layoutEdges).then((result) => {
      if (!cancelled) setLayoutedNodes(result);
    });
    return () => {
      cancelled = true;
    };
  }, [
    connectedNodeIds,
    layoutEdges,
    impactedNodeIds,
    nodes,
    selectedNodeId,
  ]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const node = layoutedNodes.find((item) => item.id === selectedNodeId);
    if (!node) return;
    const width = node.measured?.width ?? node.width ?? nodeWidth;
    const height = node.measured?.height ?? node.height ?? nodeHeight;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1.1,
      duration: 500,
    });
  }, [layoutedNodes, selectedNodeId, setCenter]);

  const focusNode = (node: Node<CodeNodeData>) => {
    const width = node.measured?.width ?? node.width ?? nodeWidth;
    const height = node.measured?.height ?? node.height ?? nodeHeight;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1.1,
      duration: 500,
    });
    onNodeClick(node.id);
  };

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={layoutedNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        onNodeClick={(_, node) => focusNode(node)}
        onMoveStart={glide.onMoveStart}
        onMove={glide.onMove}
        onMoveEnd={glide.onMoveEnd}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          nodeColor={mapColor}
          bgColor="var(--paper)"
          maskColor="var(--canvas-bg)"
          position="bottom-left"
        />
      </ReactFlow>
    </div>
  );
}
