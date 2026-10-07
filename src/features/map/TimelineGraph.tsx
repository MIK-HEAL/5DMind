import type { ConversationNode, Timeline, WorkspaceSnapshot } from "../../domain/types";
import { Layers2 } from "lucide-react";
import { getFocusedInquiryRoots, getOwnNodes, isFocusedInquiry } from "../../domain/selectors";

interface TimelineGraphProps {
  snapshot: WorkspaceSnapshot;
  timelines: Timeline[];
  currentTimelineId: string;
  selectedNodeId?: string;
  onSelect: (timelineId: string, nodeId: string) => void;
  onSwitchTimeline: (timelineId: string) => void;
  onFocusInquiry?: (nodeId: string) => void;
}

interface NodePosition {
  node: ConversationNode;
  timeline: Timeline;
  x: number;
  y: number;
  laneIndex: number;
}

const shorten = (value: string, length = 9) =>
  value.length > length ? `${value.slice(0, length)}…` : value;

const kindLabel: Record<ConversationNode["kind"], string> = {
  user: "你的消息",
  assistant: "助手回复",
  system: "系统事件",
  reference: "跨盘引用",
  merge: "合并摘要",
};

function timelineDepth(timeline: Timeline, timelines: Timeline[]): number {
  if (!timeline.parentTimelineId) return 0;
  const parent = timelines.find((item) => item.id === timeline.parentTimelineId);
  return parent ? 1 + timelineDepth(parent, timelines) : 1;
}

export function TimelineGraph({
  snapshot, timelines, currentTimelineId, selectedNodeId, onSelect, onSwitchTimeline, onFocusInquiry,
}: TimelineGraphProps) {
  const orderedTimelines = [...timelines].sort((a, b) => {
    const depthDelta = timelineDepth(a, timelines) - timelineDepth(b, timelines);
    return depthDelta || a.createdAt.localeCompare(b.createdAt);
  });
  const graphWidth = Math.max(430, 92 + (orderedTimelines.length - 1) * 154 + 92);
  const laneX = (index: number) => 54 + index * 154;
  const yStart = 64;
  const yStep = 72;
  const positions = new Map<string, NodePosition>();

  orderedTimelines.forEach((timeline, laneIndex) => {
    const ownNodes = getOwnNodes(snapshot, timeline.id).filter((node) => !isFocusedInquiry(node));
    const fork = timeline.forkedFromNodeId ? positions.get(timeline.forkedFromNodeId) : undefined;
    ownNodes.forEach((node, index) => {
      positions.set(node.id, {
        node, timeline, laneIndex, x: laneX(laneIndex),
        y: timeline.parentTimelineId ? (fork?.y ?? yStart) + (index + 1) * yStep : yStart + index * yStep,
      });
    });
  });

  const maxY = Math.max(yStart, ...[...positions.values()].map((item) => item.y));
  const graphHeight = maxY + (snapshot.references.length ? 92 : 54);
  const currentNodeIds = new Set(getOwnNodes(snapshot, currentTimelineId).filter((node) => !isFocusedInquiry(node)).map((node) => node.id));
  const inquiryStacks = [...positions.values()]
    .map((position) => ({ position, roots: getFocusedInquiryRoots(snapshot, position.node.id, position.timeline.id) }))
    .filter((item) => item.roots.length > 0);

  const activateNode = (position: NodePosition) => {
    onSelect(position.timeline.id, position.node.id);
  };

  return (
    <div className="timeline-graph-wrap">
      <div className="timeline-graph-canvas" style={{ width: graphWidth, height: graphHeight }}>
        <svg
          className="timeline-graph"
          width={graphWidth}
          height={graphHeight}
          viewBox={`0 0 ${graphWidth} ${graphHeight}`}
          role="img"
          aria-label="时间线树状图：主线向下推进，分支向右展开"
        >
        <defs>
          <marker id="reference-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>

          {orderedTimelines.map((timeline, laneIndex) => (
            <g key={`lane-${timeline.id}`} className={timeline.id === currentTimelineId ? "graph-lane current" : "graph-lane"}>
              <line x1={laneX(laneIndex)} y1={41} x2={laneX(laneIndex)} y2={maxY + 20} />
            </g>
          ))}

          {orderedTimelines.map((timeline) => {
          const ownNodes = getOwnNodes(snapshot, timeline.id).filter((node) => !isFocusedInquiry(node));
          return ownNodes.map((node, index) => {
            const current = positions.get(node.id);
            if (!current) return null;
            const previous = index > 0 ? positions.get(ownNodes[index - 1].id) : undefined;
            const fork = index === 0 && timeline.forkedFromNodeId ? positions.get(timeline.forkedFromNodeId) : undefined;
            const from = previous ?? fork;
            if (!from) return null;
            const branchEdge = from.x !== current.x;
            return (
              <path
                key={`edge-${node.id}`}
                className={`graph-edge ${timeline.id === currentTimelineId ? "current" : ""} ${branchEdge ? "branch" : ""}`}
                stroke={timeline.color}
                d={branchEdge
                  ? `M ${from.x} ${from.y} C ${from.x} ${from.y + 34}, ${current.x} ${current.y - 34}, ${current.x} ${current.y}`
                  : `M ${from.x} ${from.y} L ${current.x} ${current.y}`}
              />
            );
          });
          })}

          {snapshot.references.map((reference, index) => {
          const target = positions.get(reference.targetNodeId);
          if (!target) return null;
          const source = positions.get(reference.sourceNodeId);
          if (source) {
            return <path key={reference.id} className="graph-reference-edge" d={`M ${source.x} ${source.y} C ${source.x + 42} ${source.y}, ${target.x + 42} ${target.y}, ${target.x} ${target.y}`} markerEnd="url(#reference-arrow)" />;
          }
          const externalX = graphWidth - 82;
          const externalY = maxY + 58 + index * 26;
          return (
            <g key={reference.id}>
              <path className="graph-reference-edge" d={`M ${externalX - 28} ${externalY} C ${externalX - 82} ${externalY}, ${target.x + 56} ${target.y}, ${target.x} ${target.y}`} markerEnd="url(#reference-arrow)" />
              <g className="graph-external-node">
                <rect x={externalX - 28} y={externalY - 11} width={58} height={22} rx={4} />
                <text x={externalX + 1} y={externalY + 3} textAnchor="middle">外部盘面</text>
              </g>
            </g>
          );
          })}

          {inquiryStacks.map(({ position }) => (
            <path
              key={`inquiry-edge-${position.node.id}`}
              className="graph-inquiry-edge"
              d={`M ${position.x + 9} ${position.y} C ${position.x + 18} ${position.y}, ${position.x + 24} ${position.y - 1}, ${position.x + 34} ${position.y - 1}`}
            />
          ))}

          {[...positions.values()].map((position) => {
          const { node, timeline, x, y, laneIndex } = position;
          const selected = node.id === selectedNodeId;
          const isCurrentLine = timeline.id === currentTimelineId;
          const hasThreat = snapshot.threats.some((threat) => threat.nodeId === node.id && threat.status === "open");
          return (
            <g
              key={node.id}
              className={`graph-node ${selected ? "selected" : ""} ${isCurrentLine || currentNodeIds.has(node.id) ? "current" : ""}`}
            >
              {selected && <circle className="graph-selection-ring" cx={x} cy={y} r={15} />}
              {node.kind === "user" ? (
                <rect className="graph-node-mark" x={x - 7} y={y - 7} width={14} height={14} rx={2} transform={`rotate(45 ${x} ${y})`} fill={timeline.color} />
              ) : node.kind === "reference" ? (
                <rect className="graph-node-mark reference" x={x - 8} y={y - 8} width={16} height={16} rx={3} />
              ) : node.kind === "merge" ? (
                <circle className="graph-node-mark merge" cx={x} cy={y} r={8} />
              ) : (
                <circle className="graph-node-mark" cx={x} cy={y} r={8} fill={timeline.color} />
              )}
              <circle className="graph-node-center" cx={x} cy={y} r={2.4} />
              {hasThreat && <path className="graph-threat-mark" d={`M ${x + 8} ${y - 14} l 6 10 h -12 z`} />}
              <text className="graph-node-title" x={x} y={y + 23} textAnchor="middle">{shorten(node.summary, 7)}</text>
              <text className="graph-node-kind" x={x} y={y + 36} textAnchor="middle">{kindLabel[node.kind]}</text>
            </g>
          );
          })}
        </svg>

        {orderedTimelines.map((timeline, laneIndex) => (
          <button
            key={`lane-button-${timeline.id}`}
            className="graph-lane-button"
            style={{ left: laneX(laneIndex) - 8, top: 4 }}
            onClick={() => onSwitchTimeline(timeline.id)}
          >
            <i style={{ backgroundColor: timeline.color }} />
            <span>{shorten(timeline.name, 12)}</span>
          </button>
        ))}

        {[...positions.values()].map((position) => (
          <button
            key={`hit-${position.node.id}`}
            className="graph-node-hit"
            style={{ left: position.x - 22, top: position.y - 22 }}
            aria-label={`${position.timeline.name}，${position.node.summary}，${kindLabel[position.node.kind]}`}
            onClick={() => activateNode(position)}
          />
        ))}

        {inquiryStacks.map(({ position, roots }) => (
          <button
            key={`inquiry-stack-${position.node.id}`}
            className="graph-inquiry-stack"
            style={{ left: position.x + 14, top: position.y - 18 }}
            title={`${roots.length} 个选区追问`}
            onClick={() => onFocusInquiry?.(roots[0].id)}
          >
            <Layers2 size={12} />{roots.length}
          </button>
        ))}
      </div>
    </div>
  );
}
