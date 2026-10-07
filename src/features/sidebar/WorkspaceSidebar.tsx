import { Layers3, MessageSquareText, Plus, Settings } from "lucide-react";
import { useWorkspace } from "../../state/WorkspaceProvider";
import { useSettings } from "../../state/SettingsProvider";
import { runtimeTarget, workspaceMode } from "../../infrastructure/runtime";

export function WorkspaceSidebar() {
  const { snapshot, switchConversation, createConversation } = useWorkspace();
  const { preferences, openSettings } = useSettings();

  const handleCreate = () => {
    const title = window.prompt("新对话标题", "新的探索主题");
    if (title) createConversation(title);
  };

  return (
    <aside className="workspace-sidebar">
      <div className="brand">
        <div className="brand-mark">5D</div>
        <div><strong>5DMind</strong><span>Timeline workspace</span></div>
      </div>
      <button className="new-conversation-button" onClick={handleCreate}><Plus size={16} /><span>新建对话</span></button>
      <div className="sidebar-section-title"><span>最近对话</span></div>
      <nav className="conversation-list" aria-label="对话列表">
        {snapshot.conversations.map((conversation) => {
          const active = conversation.id === snapshot.currentConversationId;
          const timelineCount = snapshot.timelines.filter((item) => item.conversationId === conversation.id && item.status === "active").length;
          const openThreats = snapshot.threats.filter((item) => item.conversationId === conversation.id && item.status === "open").length;
          return (
            <button key={conversation.id} className={active ? "active" : ""} onClick={() => switchConversation(conversation.id)}>
              <span className="conversation-icon" style={{ color: conversation.color }}><MessageSquareText size={15} /></span>
              <span><strong>{conversation.title}</strong><small>{timelineCount} 条时间线{openThreats ? ` · ${openThreats} 个风险` : ""}</small></span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-context">
        <Layers3 size={18} />
        <div>
          <strong>{workspaceMode === "remote" ? "云端工作区" : runtimeTarget === "desktop" ? "桌面模式" : "Web 原型"}</strong>
          <span>{workspaceMode === "remote" ? "NestJS REST + SSE" : runtimeTarget === "desktop" ? "Tauri + 本地数据" : "已配置 Tauri EXE 打包"}</span>
        </div>
      </div>
      <div className="profile-row">
        <div className="avatar">{preferences.profileName.trim().slice(0, 2).toUpperCase() || "5D"}</div>
        <div><strong>{preferences.profileName || "本地用户"}</strong><span>单人工作区</span></div>
        <button type="button" title="打开设置" onClick={() => openSettings()}><Settings size={17} /></button>
      </div>
    </aside>
  );
}
