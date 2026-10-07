import { Bot, Map, Maximize2, Minimize2, PanelRightClose, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Select } from "../components/ui/Select";
import { getTimeline } from "../domain/selectors";
import { ChatPanel } from "../features/chat/ChatPanel";
import { TimelinePanel } from "../features/map/TimelinePanel";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { WorkspaceSidebar } from "../features/sidebar/WorkspaceSidebar";
import { useSettings } from "../state/SettingsProvider";
import { useWorkspace } from "../state/WorkspaceProvider";
import { workspaceMode } from "../infrastructure/runtime";
import { fullscreenSupported, isFullscreen, setFullscreen, subscribeFullscreen } from "../infrastructure/fullscreen";

export function App() {
  const {
    snapshot, hydrated, saveStatus, mapOpen, mapPinned,
    setMapOpen, switchTimeline,
  } = useWorkspace();
  const { preferences, activeAgent, setActiveAgent, openSettings } = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(() => fullscreenSupported());
  const timeline = getTimeline(snapshot, snapshot.currentTimelineId);
  const conversation = snapshot.conversations.find((item) => item.id === snapshot.currentConversationId);
  const currentTimelines = snapshot.timelines.filter(
    (item) => item.conversationId === snapshot.currentConversationId && item.status === "active",
  );
  const results = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return [];
    return snapshot.nodes.filter((node) => node.content.toLowerCase().includes(clean)).slice(0, 6);
  }, [query, snapshot.nodes]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    setCanFullscreen(fullscreenSupported());

    void isFullscreen().then((fullscreen) => {
      if (!disposed) setIsFullscreenMode(fullscreen);
    }).catch(() => {
      if (!disposed) setCanFullscreen(false);
    });

    void subscribeFullscreen((fullscreen) => {
      if (!disposed) setIsFullscreenMode(fullscreen);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unsubscribe = cleanup;
    }).catch(() => {
      if (!disposed) setCanFullscreen(false);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const toggleFullscreen = async () => {
    if (fullscreenBusy || !canFullscreen) return;
    setFullscreenBusy(true);
    try {
      await setFullscreen(!isFullscreenMode);
      setIsFullscreenMode(await isFullscreen());
    } catch {
      setCanFullscreen(false);
    } finally {
      setFullscreenBusy(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="loading-screen">
        <div className="brand-mark large">5D</div>
        <div><strong>5DMind</strong><span>{workspaceMode === "remote" ? "正在同步云端工作区…" : "正在恢复本地工作区…"}</span></div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <WorkspaceSidebar />
      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{conversation?.title ?? "未命名对话"}</strong>
            <Select
              className="timeline-select"
              value={timeline.id}
              options={currentTimelines.map((item) => ({ value: item.id, label: item.name, color: item.color }))}
              onValueChange={switchTimeline}
              ariaLabel="切换时间线"
              variant="plain"
              size="compact"
            />
          </div>
          <div className="agent-switcher">
            <span className="agent-switcher-icon" style={{ backgroundColor: activeAgent.color }}><Bot size={15} /></span>
            <div className="agent-switcher-control"><span>当前 Agent</span><Select
              className="agent-select"
              value={activeAgent.id}
              options={preferences.agents.map((agent) => {
                const provider = preferences.providers.find((item) => item.id === agent.providerId);
                return {
                  value: agent.id,
                  label: agent.name,
                  description: `${provider?.name ?? "未配置服务"} · ${agent.modelId || "未选择模型"}`,
                  color: agent.color,
                };
              })}
              onValueChange={setActiveAgent}
              ariaLabel="切换当前 Agent"
              variant="plain"
              size="compact"
            /></div>
            <small>{activeAgent.modelId || "未选择模型"}</small>
            <button type="button" title="编辑 Agents" onClick={() => openSettings("agents")}><Settings2 size={15} /></button>
          </div>
          <div className="topbar-actions">
            <span className={`save-state ${saveStatus}`}><i />{saveStatus === "saving" ? (workspaceMode === "remote" ? "同步中" : "保存中") : saveStatus === "error" ? (workspaceMode === "remote" ? "同步失败" : "保存失败") : workspaceMode === "remote" ? "已同步" : "已本地保存"}</span>
            <button className="icon-button" title="搜索消息" onClick={() => setSearchOpen((open) => !open)}><Search size={18} /></button>
            <button className="icon-button mobile-settings" title="设置" onClick={() => openSettings()}><Settings2 size={18} /></button>
            {canFullscreen && <button className="icon-button fullscreen-button" title={isFullscreenMode ? "退出全屏" : "进入全屏"} aria-label={isFullscreenMode ? "退出全屏" : "进入全屏"} aria-pressed={isFullscreenMode} disabled={fullscreenBusy} onClick={() => void toggleFullscreen()}>{isFullscreenMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
            <button className={`map-trigger ${mapOpen ? "active" : ""}`} onClick={() => setMapOpen(!mapOpen)}>
              {mapOpen ? <PanelRightClose size={17} /> : <Map size={17} />}
              {mapOpen ? "收起地图" : "时间线地图"}
              <span>{currentTimelines.length}</span>
            </button>
          </div>
        </header>

        {searchOpen && (
          <section className="search-popover">
            <Search size={17} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索所有盘面的消息…" />
            <button onClick={() => { setSearchOpen(false); setQuery(""); }}>关闭</button>
            {query && (
              <div className="search-results">
                {results.length ? results.map((node) => (
                  <button key={node.id} onClick={() => {
                    const targetTimeline = snapshot.timelines.find((item) => item.id === node.timelineId);
                    if (targetTimeline) switchTimeline(targetTimeline.id);
                    setSearchOpen(false);
                    window.setTimeout(() => document.querySelector(`[data-message-id="${node.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
                  }}>
                    <strong>{node.summary}</strong><span>{node.content.slice(0, 84)}</span>
                  </button>
                )) : <p>没有找到匹配消息</p>}
              </div>
            )}
          </section>
        )}

        <div className={`content-grid ${mapOpen && mapPinned ? "is-pinned" : ""}`}>
          <ChatPanel />
          {mapOpen && <TimelinePanel mode={mapPinned ? "pinned" : "drawer"} />}
        </div>
      </main>
      <SettingsDialog />
    </div>
  );
}
