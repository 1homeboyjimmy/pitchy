"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ReadinessNode, CategoryNode, TaskNode } from "./treeCustomNodes";
import { NodeDetailPanel } from "./NodeDetailPanel";
import type { TreeNodeResponse, TreeEdgeResponse } from "../../lib/api";

type Props = {
  treeNodes: TreeNodeResponse[];
  treeEdges: TreeEdgeResponse[];
  readinessIndex: number;
  onNodeClick?: (node: TreeNodeResponse) => void;
  onDiscussInChat?: (node: TreeNodeResponse) => void;
  onAction?: (action: string, node: TreeNodeResponse) => void;
};

/* ——— layout helpers ——— */
function buildFlowElements(
  apiNodes: TreeNodeResponse[],
  apiEdges: TreeEdgeResponse[],
  readiness: number,
  expandedIds: Set<string>,
  toggleExpand: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map(apiNodes.map((n) => [n.id, n]));

  // Determine which nodes are visible (progressive disclosure)
  const visibleIds = new Set<string>();

  // Root is always visible
  visibleIds.add("root");

  // Level 1 OR children of root always visible
  for (const n of apiNodes) {
    if (n.level <= 1 || n.parent_id === "root") visibleIds.add(n.id);
  }

  // Auto-expand any node that is visible
  function revealChildren(parentId: string) {
    const parent = nodeMap.get(parentId);
    if (!parent) return;
    for (const childId of (parent.children_ids || [])) {
      visibleIds.add(childId);
      if (expandedIds.has(childId)) {
        revealChildren(childId);
      }
    }
  }
  for (const id of expandedIds) {
    if (visibleIds.has(id)) {
      revealChildren(id);
    }
  }

  // Safety net: if AI returned nodes but our strict level/parent logic hid ALL of them,
  // just show everything so the user doesn't get an empty canvas.
  if (visibleIds.size === 1 && apiNodes.length > 0) { // Only "root" is visible
    for (const n of apiNodes) {
      visibleIds.add(n.id);
    }
  }

  // Auto-layout positions
  const positions = autoLayout(apiNodes, visibleIds);

  // Build React Flow nodes
  const nodes: Node[] = [];

  // Root readiness node
  nodes.push({
    id: "root",
    type: "readinessNode",
    position: positions.get("root") || { x: 400, y: 30 },
    data: { label: "Индекс готовности", readiness: readiness, status: "completed" },
    draggable: true,
  });

  for (const n of apiNodes) {
    if (!visibleIds.has(n.id) || n.id === "root") continue;

    const pos = positions.get(n.id) || { x: 0, y: 0 };
    const childCount = n.children_ids?.length || 0;
    const expanded = expandedIds.has(n.id);
    
    // Calculate progress for the node badge
    const inputs = n.data?.inputs || [];
    const totalReq = inputs.filter((i) => i.required).length;
    const filledReq = inputs.filter((i) => i.required && i.status === "completed").length;
    const progress = totalReq > 0 ? `${filledReq}/${totalReq}` : undefined;

    if (n.level === 1) {
      nodes.push({
        id: n.id,
        type: "categoryNode",
        position: pos,
        data: {
          label: n.label,
          category: n.category || "product",
          status: n.status,
          childCount,
          expanded,
          onToggle: () => toggleExpand(n.id),
        },
        draggable: true,
      });
    } else {
      nodes.push({
        id: n.id,
        type: "taskNode",
        position: pos,
        data: {
          label: n.label,
          nodeType: n.type,
          status: n.status,
          childCount,
          expanded,
          progress,
          summary: n.data.summary,
          onToggle: () => toggleExpand(n.id),
        },
        draggable: true,
      });
    }
  }

  // Build edges (only between visible nodes)
  const edges: Edge[] = apiEdges
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: true,
      style: { stroke: "rgba(168,85,247,0.3)", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(168,85,247,0.4)", width: 12, height: 12 },
    }));

  return { nodes, edges };
}

function autoLayout(apiNodes: TreeNodeResponse[], visibleIds: Set<string>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodeMap = new Map(apiNodes.map((n) => [n.id, n]));

  // Group visible nodes by level
  const byLevel = new Map<number, string[]>();
  // Root
  byLevel.set(-1, ["root"]);
  for (const n of apiNodes) {
    if (!visibleIds.has(n.id)) continue;
    const level = n.level;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(n.id);
  }

  const yGap = 140;
  const xGap = 220;

  // Root position
  positions.set("root", { x: 400, y: 30 });

  // Layout each level centered
  const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    if (level === -1) continue;
    const ids = byLevel.get(level)!;
    const count = ids.length;
    const totalWidth = (count - 1) * xGap;
    const startX = 400 - totalWidth / 2;

    for (let i = 0; i < ids.length; i++) {
      // Try to position near parent
      const node = nodeMap.get(ids[i]);
      const parentPos = node?.parent_id ? positions.get(node.parent_id) : null;
      
      const x = parentPos 
        ? parentPos.x + (i - (ids.length - 1) / 2) * (xGap * 0.8)
        : startX + i * xGap;
      
      positions.set(ids[i], {
        x,
        y: 30 + (level + 1) * yGap,
      });
    }
  }

  return positions;
}

/* ——— Component ——— */

const nodeTypes: NodeTypes = {
  readinessNode: ReadinessNode,
  categoryNode: CategoryNode,
  taskNode: TaskNode,
};

export function TreeCanvas({
  treeNodes,
  treeEdges,
  readinessIndex,
  onNodeClick,
  onDiscussInChat,
  onAction,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNodeResponse | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => buildFlowElements(treeNodes, treeEdges, readinessIndex, expandedIds, toggleExpand),
    [treeNodes, treeEdges, readinessIndex, expandedIds, toggleExpand],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync when flowNodes/flowEdges change (new data from WS etc.)
  useMemo(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const apiNode = treeNodes.find((n) => n.id === node.id);
      if (apiNode) {
        setSelectedNode(apiNode);
        onNodeClick?.(apiNode);
      }
    },
    [treeNodes, onNodeClick],
  );

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-[#0a0818]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="tree-canvas"
      >
        <Background color="rgba(168,85,247,0.05)" gap={25} size={1} />
        <Controls
          className="!bg-white/5 !border-white/10 !rounded-xl [&>button]:!bg-white/5 [&>button]:!border-white/10 [&>button]:!text-white/50 [&>button:hover]:!bg-white/10"
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === "readinessNode") return "#a855f7";
            if (n.type === "categoryNode") return "#8b5cf6";
            return "#6366f1";
          }}
          maskColor="rgba(10,8,24,0.8)"
          className="!bg-white/5 !border-white/10 !rounded-xl"
        />
      </ReactFlow>

      {/* Detail Panel */}
      <NodeDetailPanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onDiscussInChat={(n) => {
          onDiscussInChat?.(n);
          setSelectedNode(null);
        }}
        onAction={(action, node) => {
          onAction?.(action, node);
          setSelectedNode(null);
        }}
      />
    </div>
  );
}
