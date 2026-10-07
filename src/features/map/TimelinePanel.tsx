import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  Link2,
  Layers2,
  MapPinned,
  Merge,
  Pin,
  PinOff,
  Radar,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getInquiryTree, getOwnNodes, isFocusedInquiry } from "../../domain/selectors";
import { useWorkspace } from "../../state/WorkspaceProvider";
import { TimelineGraph } from "./TimelineGraph";

function isInBranch(nodeId: string, branchRootId: string, tree: ReturnType<typeof getInquiryTree>) {
  if (nodeId === branchRootId) return true;
  let current = tree.find((node) => node.id === nodeId);
  let depth = 0;
  while (current?.parentNodeId && depth < 32) {
    if (current.parentNodeId === branchRootId) return true;
    current = tree.find((node) => node.id === current?.parentNodeId);
    depth += 1;
  }
  return false;
}

export function TimelinePanel({ mode }: { mode: "drawer" | "pinned" }) {
  const {
    snapshot, selectedNodeId, focusedInquiryId, focusedInquiryIds, focusInquiry, openInquiry, closeInquiry, mapPinned, setMapOpen, setMapPinned, switchTimeline, selectNode,
    compareIds, toggleCompare, createMergeSummary, resolveThreat,
  } = useWorkspace();
  const [view, setView] = useState<"map" | "compare">("map");
  const [showResolved, setShowResolved] = useState(false);
  const [expandedInquiryWindows, setExpandedInquiryWindows] = useState<Record<string, boolean>>({});
  const [expandedInquiryNodes, setExpandedInquiryNodes] = useState<Record<string, string>>({});
  const currentTimelines = snapshot.timelines.filter(
    (timeline) => timeline.conversationId === snapshot.currentConversationId && timeline.status === "active",
  );
  const current = snapshot.currentTimelineId;
  const nodeCount = currentTimelines.reduce((total, timeline) => total + getOwnNodes(snapshot, timeline.id).filter((node) => !isFocusedInquiry(node)).length, 0);
  const openThreats = snapshot.threats.filter((threat) => threat.status === "open");
  const visibleThreats = snapshot.threats.filter((threat) => showResolved || threat.status === "open");
  const inquiryWindows = focusedInquiryIds.flatMap((rootId) => {
    const root = snapshot.nodes.find((node) => node.id === rootId && isFocusedInquiry(node));
    return root ? [{ root, tree: getInquiryTree(snapshot, root.id) }] : [];
  });
  const compareLines = useMemo(() => compareIds.map((id) => {
    const timeline = snapshot.timelines.find((item) => item.id === id)!;
    const ownNodes = getOwnNodes(snapshot, id);
    return { timeline, ownNodes, last: ownNodes.at(-1) };
  }), [compareIds, snapshot]);

  return (
    <aside className={`timeline-panel ${mode}`}>
      <header className="map-header">
        <div><span className="eyebrow">结构导航器</span><h2>时间线地图</h2></div>
        <div className="map-header-actions">
          <button title={mapPinned ? "取消固定" : "固定地图"} onClick={() => setMapPinned(!mapPinned)}>{mapPinned ? <PinOff size={17} /> : <Pin size={17} />}</button>
          <button title="关闭地图" onClick={() => setMapOpen(false)}><X size={18} /></button>
        </div>
      </header>
      <div className="map-tabs"><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>路线图</button><button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>比较 <span>{compareIds.length}/2</span></button></div>

      {view === "map" ? (
        <div className="map-scroll">
          <div className="map-summary"><div><strong>{currentTimelines.length}</strong><span>活跃时间线</span></div><div><strong>{nodeCount}</strong><span>结构节点</span></div><div className={openThreats.length ? "warning" : "ok"}><strong>{openThreats.length}</strong><span>开放风险</span></div></div>
          <section className="map-section">
            <div className="section-heading"><span>时间线拓扑</span><small>时间向下 · 分支向右</small></div>
            <TimelineGraph
              snapshot={snapshot}
              timelines={currentTimelines}
              currentTimelineId={current}
              selectedNodeId={selectedNodeId}
              onSwitchTimeline={switchTimeline}
              onFocusInquiry={(nodeId) => { openInquiry(nodeId); selectNode(nodeId); }}
              onSelect={(timelineId, nodeId) => { switchTimeline(timelineId); window.setTimeout(() => selectNode(nodeId), 0); }}
            />
          </section>

          {inquiryWindows.length > 0 && (
            <section className="map-section inquiry-map-section">
              <div className="section-heading"><span>选区探索 · {inquiryWindows.length} 个窗口</span><button onClick={() => inquiryWindows.forEach(({ root }) => closeInquiry(root.id))}>关闭全部 <X size={12} /></button></div>
              <div className="inquiry-map-windows">
                {inquiryWindows.map(({ root, tree }, index) => {
                  const activeInWindow = tree.some((node) => node.id === focusedInquiryId);
                  const expanded = expandedInquiryWindows[root.id] ?? activeInWindow;
                  const branchRootId = expandedInquiryNodes[root.id] ?? root.id;
                  const visibleTree = expanded
                    ? tree.filter((node) => isInBranch(node.id, branchRootId, tree) || node.id === root.id)
                    : [];
                  return (
                    <article className={`inquiry-map-window ${activeInWindow ? "is-active" : ""}`} key={root.id}>
                      <header>
                        <button onClick={() => {
                          setExpandedInquiryWindows((current) => ({ ...current, [root.id]: !expanded }));
                          setExpandedInquiryNodes((current) => ({ ...current, [root.id]: root.id }));
                          focusInquiry(root.id);
                          selectNode(root.id);
                        }}>
                          <i>{index + 1}</i>
                          <span><strong>{root.summary}</strong><small>{root.focusSelection?.text ?? "已保存选区"}</small></span>
                          <ChevronDown className={expanded ? "is-rotated" : ""} size={14} />
                        </button>
                        <button title="关闭此窗口" onClick={() => closeInquiry(root.id)}><X size={13} /></button>
                      </header>
                      {!expanded ? (
                        <div className="inquiry-map-stack-preview">
                          <div className="inquiry-map-stack-cards" aria-hidden="true"><span /><span /><span /></div>
                          <span><strong>{Math.max(0, tree.length - 1)} 个后续节点</strong><small>点击展开这棵追问树</small></span>
                          <Layers2 size={16} />
                        </div>
                      ) : (
                        <div className="inquiry-map-tree">
                          {visibleTree.map((node) => {
                            let depth = 0;
                            let parent = node.parentNodeId;
                            while (parent && parent !== root.id && depth < 4) {
                              const parentNode = tree.find((item) => item.id === parent);
                              if (!parentNode) break;
                              depth += 1;
                              parent = parentNode.parentNodeId;
                            }
                            return <button key={node.id} className={`inquiry-map-node ${node.kind} ${focusedInquiryId === node.id ? "is-active" : ""}`} style={{ marginLeft: depth * 14 }} onClick={() => { setExpandedInquiryWindows((current) => ({ ...current, [root.id]: true })); setExpandedInquiryNodes((current) => ({ ...current, [root.id]: node.id })); focusInquiry(node.id); selectNode(node.id); }}><span>{node.kind === "user" ? "你" : "5D"}</span><strong>{node.summary}</strong><small>{node.content}</small></button>;
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <section className="map-section relation-section">
            <div className="section-heading"><span>多盘引用</span><small>{snapshot.references.length} 条关系</small></div>
            {snapshot.references.map((reference) => {
              const source = snapshot.nodes.find((node) => node.id === reference.sourceNodeId);
              const target = snapshot.nodes.find((node) => node.id === reference.targetNodeId);
              if (!source || !target) return null;
              return <button className="relation-card" key={reference.id} onClick={() => { switchTimeline(target.timelineId); selectNode(target.id); }}><span className="relation-icon"><Link2 size={15} /></span><span><strong>{source.summary}</strong><small><ArrowRight size={12} />{target.summary}</small></span><MapPinned size={14} /></button>;
            })}
          </section>

          <section className="map-section risk-section">
            <div className="section-heading"><span>威胁与风险</span><button onClick={() => setShowResolved(!showResolved)}>{showResolved ? "隐藏已解决" : "显示已解决"}<ChevronDown size={13} /></button></div>
            {visibleThreats.length ? visibleThreats.map((threat) => <div className={`risk-card ${threat.severity} ${threat.status}`} key={threat.id}><div className="risk-icon"><AlertTriangle size={15} /></div><div><strong>{threat.title}</strong><p>{threat.detail}</p><button onClick={() => { const node = snapshot.nodes.find((item) => item.id === threat.nodeId); if (node) { switchTimeline(node.timelineId); selectNode(node.id); } }}>{threat.status === "resolved" ? "查看来源" : "定位来源"}<ArrowRight size={13} /></button></div>{threat.status === "open" && <button className="risk-resolve" title="标记为已解决" onClick={() => resolveThreat(threat.id)}><Check size={14} /></button>}</div>) : <div className="empty-map"><Radar size={18} /><span>目前没有开放风险</span></div>}
          </section>
        </div>
      ) : (
        <div className="compare-view">
          <div className="compare-intro"><GitBranch size={18} /><div><strong>比较两条探索路径</strong><span>选择时间线查看共同祖先、差异节点和最新结论。</span></div></div>
          <div className="compare-picker">{currentTimelines.map((timeline) => <button key={timeline.id} className={compareIds.includes(timeline.id) ? "selected" : ""} onClick={() => toggleCompare(timeline.id)}><i style={{ backgroundColor: timeline.color }} /><span>{timeline.name}</span>{compareIds.includes(timeline.id) && <Check size={15} />}</button>)}</div>
          {compareIds.length < 2 ? <div className="compare-empty"><GitBranch size={24} /><strong>还差 {2 - compareIds.length} 条时间线</strong><span>在上方选择两条路线开始比较。</span></div> : <>
            <div className="compare-columns">{compareLines.map(({ timeline, ownNodes, last }) => <section key={timeline.id}><div className="compare-column-head"><i style={{ backgroundColor: timeline.color }} /><strong>{timeline.name}</strong><span>{ownNodes.length} 个独立节点</span></div><div className="compare-conclusion"><span>最新结论</span><strong>{last?.summary ?? "尚无结论"}</strong><p>{last?.content.slice(0, 150) ?? ""}</p></div><div className="compare-node-list">{ownNodes.map((node) => <button key={node.id} onClick={() => { switchTimeline(timeline.id); selectNode(node.id); }}><span>{node.kind === "user" ? "你" : "5D"}</span>{node.summary}</button>)}</div></section>)}</div>
            <div className="merge-action"><div><Merge size={18} /><span><strong>保留来源的合并摘要</strong><small>将在当前时间线上创建新节点，不覆盖原始内容。</small></span></div><button className="primary" onClick={createMergeSummary}>生成合并摘要</button></div>
          </>}
        </div>
      )}
      <footer className="map-footer"><span><span className="legend-dot" />当前编辑线</span><span><span className="legend-line" />继承上下文</span><span><AlertTriangle size={12} />开放风险</span></footer>
    </aside>
  );
}
