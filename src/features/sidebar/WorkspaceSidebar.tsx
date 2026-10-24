import {
  Layers3,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { useWorkspace } from "../../state/WorkspaceProvider";
import { useSettings } from "../../state/SettingsProvider";
import { runtimeTarget, workspaceMode } from "../../infrastructure/runtime";

const SIDEBAR_COLLAPSED_KEY = "5dmind.sidebar.collapsed";

interface WorkspaceSidebarProps {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

interface ConversationTarget {
  id: string;
  title: string;
}

interface MenuPosition {
  top: number;
  left: number;
}

export function WorkspaceSidebar({ mobileOpen = false, onMobileOpenChange }: WorkspaceSidebarProps) {
  const { snapshot, switchConversation, createConversation, renameConversation, deleteConversation } = useWorkspace();
  const { preferences, openSettings } = useSettings();
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [menuId, setMenuId] = useState<string>();
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const [renameTarget, setRenameTarget] = useState<ConversationTarget>();
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationTarget>();
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const visualCollapsed = collapsed && !mobileOpen;

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const closeMenu = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".conversation-row")) return;
      setMenuId(undefined);
      setMenuPosition(undefined);
    };
    const closeOnViewportChange = () => {
      setMenuId(undefined);
      setMenuPosition(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuId(undefined);
      setMenuPosition(undefined);
      setRenameTarget(undefined);
      setDeleteTarget(undefined);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, []);

  const closeMenu = () => {
    setMenuId(undefined);
    setMenuPosition(undefined);
  };

  const closeMobileSidebar = () => onMobileOpenChange?.(false);

  const reportActionError = (error: unknown, fallback: string) => {
    setActionError(error instanceof Error && error.message ? error.message : fallback);
  };

  const handleCreate = () => {
    const title = window.prompt("新对话标题", "新的探索主题");
    if (!title?.trim()) return;
    void createConversation(title).catch((error) => reportActionError(error, "新建对话失败，请重试"));
  };

  const handleRename = (conversationId: string, currentTitle: string) => {
    closeMenu();
    setActionError(undefined);
    setRenameDraft(currentTitle);
    setRenameTarget({ id: conversationId, title: currentTitle });
  };

  const handleDelete = (conversationId: string, title: string) => {
    closeMenu();
    if (snapshot.conversations.length <= 1) {
      setActionError("至少需要保留一个对话");
      return;
    }
    setActionError(undefined);
    setDeleteTarget({ id: conversationId, title });
  };

  const toggleMenu = (conversationId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuId === conversationId) {
      closeMenu();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 154;
    const left = visualCollapsed ? rect.right + 7 : Math.max(8, rect.right - menuWidth);
    setMenuId(conversationId);
    setMenuPosition({
      top: Math.min(window.innerHeight - 92, rect.bottom + 4),
      left: Math.min(window.innerWidth - menuWidth - 8, left),
    });
  };

  const submitRename = async () => {
    if (!renameTarget || !renameDraft.trim() || pendingAction) return;
    setPendingAction(true);
    setActionError(undefined);
    try {
      await renameConversation(renameTarget.id, renameDraft);
      setRenameTarget(undefined);
    } catch (error) {
      reportActionError(error, "重命名失败，请重试");
    } finally {
      setPendingAction(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget || pendingAction) return;
    setPendingAction(true);
    setActionError(undefined);
    try {
      await deleteConversation(deleteTarget.id);
      setDeleteTarget(undefined);
    } catch (error) {
      reportActionError(error, "删除失败，请重试");
    } finally {
      setPendingAction(false);
    }
  };

  return (
    <>
      <aside
        id="workspace-sidebar"
        className={`workspace-sidebar ${visualCollapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
      >
        <div className="brand">
          <div className="brand-mark">5D</div>
          <div className="brand-copy">
            <strong>5DMind</strong>
            <span>Timeline workspace</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            title={mobileOpen ? "关闭工作区导航" : visualCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-label={mobileOpen ? "关闭工作区导航" : visualCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-controls="workspace-sidebar"
            aria-expanded={mobileOpen || !visualCollapsed}
            aria-pressed={!mobileOpen && visualCollapsed}
            onClick={() => {
              if (mobileOpen) closeMobileSidebar();
              else setCollapsed((value) => !value);
              closeMenu();
            }}
          >
            {mobileOpen ? (
              <X size={17} />
            ) : visualCollapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        <button className="new-conversation-button" title="新建对话" onClick={handleCreate}>
          <Plus size={16} />
          <span>新建对话</span>
        </button>
        <div className="sidebar-section-title">
          <span>最近对话</span>
          <small>{snapshot.conversations.length}</small>
        </div>
        <nav className="conversation-list" aria-label="对话列表">
          {snapshot.conversations.map((conversation) => {
            const active = conversation.id === snapshot.currentConversationId;
            const timelineCount = snapshot.timelines.filter(
              (item) => item.conversationId === conversation.id && item.status === "active",
            ).length;
            const openThreats = snapshot.threats.filter(
              (item) => item.conversationId === conversation.id && item.status === "open",
            ).length;
            return (
              <div key={conversation.id} className={`conversation-row ${active ? "active" : ""}`}>
                <button
                  className="conversation-main"
                  title={visualCollapsed ? conversation.title : undefined}
                  onClick={() => {
                    switchConversation(conversation.id);
                    closeMenu();
                    closeMobileSidebar();
                  }}
                >
                  <span className="conversation-icon" style={{ color: conversation.color }}>
                    <MessageSquareText size={15} />
                  </span>
                  <span className="conversation-copy">
                    <strong>{conversation.title}</strong>
                    <small>
                      {timelineCount} 条时间线{openThreats ? ` · ${openThreats} 个风险` : ""}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="conversation-more"
                  title="对话操作"
                  aria-label={`${conversation.title} 对话操作`}
                  aria-expanded={menuId === conversation.id}
                  onClick={(event) => toggleMenu(conversation.id, event)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuId === conversation.id && (
                  <div
                    className="conversation-menu"
                    role="menu"
                    style={menuPosition}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleRename(conversation.id, conversation.title)}
                    >
                      <Pencil size={14} />
                      重命名
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => handleDelete(conversation.id, conversation.title)}
                    >
                      <Trash2 size={14} />
                      删除对话
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-context">
          <Layers3 size={18} />
          <div>
            <strong>
              {workspaceMode === "remote" ? "云端工作区" : runtimeTarget === "desktop" ? "桌面模式" : "Web 原型"}
            </strong>
            <span>
              {workspaceMode === "remote"
                ? "NestJS REST + SSE"
                : runtimeTarget === "desktop"
                  ? "Tauri + 本地数据"
                  : "已配置 Tauri EXE 打包"}
            </span>
          </div>
        </div>
        <div className="profile-row">
          <div className="avatar">{preferences.profileName.trim().slice(0, 2).toUpperCase() || "5D"}</div>
          <div>
            <strong>{preferences.profileName || "本地用户"}</strong>
            <span>单人工作区</span>
          </div>
          <button type="button" title="打开设置" aria-label="打开设置" onClick={() => openSettings()}>
            <Settings size={17} />
          </button>
        </div>

        {actionError && !renameTarget && !deleteTarget && (
          <div className="sidebar-action-notice" role="status">
            <span>{actionError}</span>
            <button type="button" title="关闭提示" aria-label="关闭提示" onClick={() => setActionError(undefined)}>
              ×
            </button>
          </div>
        )}

        {renameTarget && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={() => !pendingAction && setRenameTarget(undefined)}
          >
            <section
              className="modal sidebar-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-conversation-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <strong id="rename-conversation-title">重命名对话</strong>
                <button type="button" title="关闭" onClick={() => !pendingAction && setRenameTarget(undefined)}>
                  <span aria-hidden="true">×</span>
                </button>
              </header>
              <div className="modal-content">
                <label>
                  对话名称
                  <input
                    autoFocus
                    value={renameDraft}
                    maxLength={200}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRename();
                    }}
                  />
                </label>
                {actionError && (
                  <p className="sidebar-dialog-error" role="alert">
                    {actionError}
                  </p>
                )}
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pendingAction}
                  onClick={() => setRenameTarget(undefined)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={pendingAction || !renameDraft.trim()}
                  onClick={() => void submitRename()}
                >
                  {pendingAction ? "保存中…" : "保存"}
                </button>
              </footer>
            </section>
          </div>
        )}

        {deleteTarget && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={() => !pendingAction && setDeleteTarget(undefined)}
          >
            <section
              className="modal sidebar-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-conversation-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <strong id="delete-conversation-title">删除对话</strong>
                <button type="button" title="关闭" onClick={() => !pendingAction && setDeleteTarget(undefined)}>
                  <span aria-hidden="true">×</span>
                </button>
              </header>
              <div className="modal-content">
                <p className="sidebar-delete-copy">确定删除“{deleteTarget.title}”吗？</p>
                <p className="sidebar-delete-warning">该对话的时间线、消息、风险和引用关系都会被永久删除。</p>
                {actionError && (
                  <p className="sidebar-dialog-error" role="alert">
                    {actionError}
                  </p>
                )}
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pendingAction}
                  onClick={() => setDeleteTarget(undefined)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={pendingAction}
                  onClick={() => void submitDelete()}
                >
                  {pendingAction ? "删除中…" : "删除对话"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </aside>
      {mobileOpen && (
        <button
          type="button"
          className="sidebar-mobile-backdrop"
          aria-label="关闭工作区导航"
          onClick={closeMobileSidebar}
        />
      )}
    </>
  );
}
