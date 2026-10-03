import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { GraphEdge, GraphNode } from '../types/contracts'

interface CodeNodeData extends Record<string, unknown> {
  graphNode: GraphNode
  impacted: boolean
  selected: boolean
}

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  impactedNodeIds: string[]
  selectedNodeId?: string
  onNodeClick: (id: string) => void
}

const elk = new ELK()
const nodeWidth = 190
const nodeHeight = 88

function CodeNode({ data }: NodeProps<Node<CodeNodeData>>) {
  const { graphNode, impacted, selected } = data
  return (
    <div
      className={`flow-node node-${graphNode.type} ${
        impacted ? 'flow-node-impacted' : ''
      } ${selected ? 'flow-node-selected' : ''}`}
    >
      <Handle className="flow-handle" position={Position.Left} type="target" />
      <span className="node-type">{graphNode.type}</span>
      <strong>{graphNode.name}</strong>
      <small>{graphNode.path}</small>
      <Handle className="flow-handle" position={Position.Right} type="source" />
    </div>
  )
}

const nodeTypes = { code: CodeNode }

async function layoutGraph(
  nodes: Node<CodeNodeData>[],
  edges: Edge[],
): Promise<Node<CodeNodeData>[]> {
  const layout = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '35',
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
  })

  const positions = new Map(
    (layout.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  )
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }))
}

export function GraphCanvas({
  nodes,
  edges,
  impactedNodeIds,
  selectedNodeId,
  onNodeClick,
}: GraphCanvasProps) {
  const [layoutedNodes, setLayoutedNodes] = useState<Node<CodeNodeData>[]>([])
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => ({
        id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.type,
        className: `flow-edge edge-${edge.type.toLowerCase()}`,
      })),
    [edges],
  )

  useEffect(() => {
    let cancelled = false
    const baseNodes: Node<CodeNodeData>[] = nodes.map((graphNode) => ({
      id: graphNode.id,
      type: 'code',
      position: { x: 0, y: 0 },
      data: {
        graphNode,
        impacted: impactedNodeIds.includes(graphNode.id),
        selected: selectedNodeId === graphNode.id,
      },
    }))

    void layoutGraph(baseNodes, flowEdges).then((result) => {
      if (!cancelled) setLayoutedNodes(result)
    })
    return () => {
      cancelled = true
    }
  }, [flowEdges, impactedNodeIds, nodes, selectedNodeId])

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={layoutedNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2a302e" gap={24} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as CodeNodeData
            return data.impacted ? '#ff9b5c' : '#c6f36b'
          }}
        />
      </ReactFlow>
    </div>
  )
}
