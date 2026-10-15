import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  Database,
  Download,
  HardDrive,
  KeyRound,
  Languages,
  Plus,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Select } from "../../components/ui/Select";
import type {
  AgentPermissionMode,
  ModelProvider,
  ProviderType,
  ReasoningEffort,
  SettingsSection,
} from "../../domain/settings";
import { runtimeTarget } from "../../infrastructure/runtime";
import { sanitizeProviderUrl } from "../../infrastructure/settingsRepository";
import { useSettings } from "../../state/SettingsProvider";
import { useWorkspace } from "../../state/WorkspaceProvider";

const sections: Array<{ id: SettingsSection; label: string; icon: typeof Settings2 }> = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "providers", label: "模型服务", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "data", label: "数据与存储", icon: Database },
];

const providerTypeLabels: Record<ProviderType, string> = {
  local: "本地模型（未连接）",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  ollama: "Ollama",
  "openai-compatible": "OpenAI 兼容",
};

function providerNeedsApiKey(type: ProviderType, baseUrl = "") {
  if (type === "openai" || type === "anthropic" || type === "gemini") return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingsRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div><strong>{title}</strong>{detail && <span>{detail}</span>}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function GeneralSettings() {
  const { preferences, updatePreferences } = useSettings();
  return (
    <div className="settings-page">
      <header className="settings-page-header"><span>偏好设置</span><h2>通用</h2><p>调整工作区、输入方式和对话阅读体验。</p></header>
      <section className="settings-group">
        <h3>账户与显示</h3>
        <SettingsRow title="显示名称" detail="显示在本地对话中的用户名称">
          <label className="field-with-icon"><UserRound size={15} /><input value={preferences.profileName} onChange={(event) => updatePreferences({ profileName: event.target.value })} aria-label="显示名称" /></label>
        </SettingsRow>
        <SettingsRow title="界面语言">
          <Select
            className="settings-row-select"
            value={preferences.language}
            options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]}
            onValueChange={(language) => updatePreferences({ language: language as "zh-CN" | "en-US" })}
            ariaLabel="界面语言"
            leadingIcon={<Languages size={15} />}
          />
        </SettingsRow>
        <SettingsRow title="消息字号" detail="只影响聊天正文">
          <div className="segmented-control" aria-label="消息字号">
            {(["small", "medium", "large"] as const).map((size) => <button type="button" className={preferences.messageFontSize === size ? "active" : ""} key={size} onClick={() => updatePreferences({ messageFontSize: size })}>{size === "small" ? "小" : size === "medium" ? "中" : "大"}</button>)}
          </div>
        </SettingsRow>
      </section>
      <section className="settings-group">
        <h3>对话</h3>
        <SettingsRow title="按 Enter 发送" detail="关闭后使用 Ctrl / Command + Enter 发送">
          <Toggle checked={preferences.sendWithEnter} onChange={(sendWithEnter) => updatePreferences({ sendWithEnter })} label="按 Enter 发送" />
        </SettingsRow>
        <SettingsRow title="显示时间" detail="在消息作者旁显示发送时间">
          <Toggle checked={preferences.showTimestamps} onChange={(showTimestamps) => updatePreferences({ showTimestamps })} label="显示消息时间" />
        </SettingsRow>
      </section>
    </div>
  );
}

function ProviderSettings() {
  const {
    preferences, addProvider, updateProvider, deleteProvider,
    providerCredentialStatus, saveProviderApiKey, clearProviderApiKey, testProviderConnection, refreshProviderModels,
  } = useSettings();
  const [selectedId, setSelectedId] = useState(preferences.providers[0]?.id ?? "");
  const [modelDraft, setModelDraft] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string>();
  const [connectionOk, setConnectionOk] = useState<boolean>();
  const selected = preferences.providers.find((provider) => provider.id === selectedId) ?? preferences.providers[0];
  const linkedAgents = preferences.agents.filter((agent) => agent.providerId === selected?.id).length;
  const hasCredential = Boolean(selected && providerCredentialStatus[selected.id]);
  const keyRequired = selected ? providerNeedsApiKey(selected.type, selected.baseUrl) : false;

  useEffect(() => {
    if (!selected && preferences.providers[0]) setSelectedId(preferences.providers[0].id);
  }, [preferences.providers, selected]);

  useEffect(() => {
    setApiKeyDraft("");
    setConnectionMessage(undefined);
    setConnectionOk(undefined);
  }, [selectedId]);

  if (!selected) return null;
  const addModel = () => {
    const model = modelDraft.trim();
    if (!model || selected.models.includes(model)) return;
    updateProvider(selected.id, { models: [...selected.models, model] });
    setModelDraft("");
  };
  const saveKey = async () => {
    if (!apiKeyDraft.trim()) return;
    setCredentialBusy(true);
    setConnectionMessage(undefined);
    try {
      await saveProviderApiKey(selected.id, apiKeyDraft);
      setApiKeyDraft("");
      setConnectionOk(true);
      setConnectionMessage("API Key 已保存到系统凭据库");
    } catch (error) {
      setConnectionOk(false);
      setConnectionMessage(error instanceof Error ? error.message : "保存 API Key 失败");
    } finally {
      setCredentialBusy(false);
    }
  };
  const clearKey = async () => {
    setCredentialBusy(true);
    try {
      await clearProviderApiKey(selected.id);
      setApiKeyDraft("");
      setConnectionOk(undefined);
      setConnectionMessage("API Key 已从系统凭据库删除");
    } catch (error) {
      setConnectionOk(false);
      setConnectionMessage(error instanceof Error ? error.message : "删除 API Key 失败");
    } finally {
      setCredentialBusy(false);
    }
  };
  const testConnection = async () => {
    setConnectionBusy(true);
    setConnectionMessage(undefined);
    try {
      const result = await testProviderConnection(selected.id, selected.models[0]);
      setConnectionOk(result.ok);
      setConnectionMessage(result.message);
    } catch (error) {
      setConnectionOk(false);
      setConnectionMessage(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setConnectionBusy(false);
    }
  };
  const refreshModels = async () => {
    setModelsBusy(true);
    setConnectionMessage(undefined);
    try {
      const models = await refreshProviderModels(selected.id);
      setConnectionOk(true);
      setConnectionMessage(`已刷新 ${models.length} 个模型`);
    } catch (error) {
      setConnectionOk(false);
      setConnectionMessage(error instanceof Error ? error.message : "刷新模型失败");
    } finally {
      setModelsBusy(false);
    }
  };
  return (
    <div className="settings-page provider-settings-page">
      <header className="settings-page-header"><span>模型与连接</span><h2>模型服务</h2><p>统一管理本地模型和兼容的远程模型提供方。</p></header>
      <div className="settings-split">
        <aside className="settings-list-pane">
          <div className="settings-list-heading"><strong>提供方</strong><button type="button" title="添加模型服务" onClick={() => { const id = addProvider(); setSelectedId(id); }}><Plus size={16} /></button></div>
          <div className="settings-item-list">
            {preferences.providers.map((provider) => (
              <button type="button" key={provider.id} className={provider.id === selected.id ? "active" : ""} onClick={() => setSelectedId(provider.id)}>
                <span className={`provider-badge ${provider.enabled ? "enabled" : ""}`}>{provider.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{provider.name}</strong><small>{providerTypeLabels[provider.type]} · {provider.models.length} 个模型</small></span>
                <i className={provider.enabled ? "online" : ""} />
              </button>
            ))}
          </div>
        </aside>
        <section className="settings-detail-pane">
          <div className="detail-title-row">
            <div className={`provider-badge large ${selected.enabled ? "enabled" : ""}`}>{selected.name.slice(0, 1).toUpperCase()}</div>
            <div><h3>{selected.name}</h3><span>{selected.enabled ? "已启用" : "未启用"}</span></div>
            <Toggle checked={selected.enabled} onChange={(enabled) => updateProvider(selected.id, { enabled })} label="启用模型服务" />
          </div>
          <div className="settings-form-grid">
            <label><span>服务名称</span><input value={selected.name} onChange={(event) => updateProvider(selected.id, { name: event.target.value })} /></label>
            <div className="settings-form-field"><span>API 类型</span><Select value={selected.type} options={Object.entries(providerTypeLabels).map(([value, label]) => ({ value, label }))} onValueChange={(type) => updateProvider(selected.id, { type: type as ProviderType })} ariaLabel="API 类型" /></div>
            <label className="full"><span>API Host</span><input value={selected.baseUrl} disabled={selected.type === "local"} placeholder="https://api.example.com/v1" onChange={(event) => updateProvider(selected.id, { baseUrl: sanitizeProviderUrl(event.target.value) })} onBlur={(event) => updateProvider(selected.id, { baseUrl: sanitizeProviderUrl(event.target.value) })} /></label>
            <label className="full"><span>API Path（可选）</span><input value={selected.apiPath ?? ""} disabled={selected.type === "local"} placeholder="/chat/completions 或留空使用默认路径" onChange={(event) => updateProvider(selected.id, { apiPath: event.target.value || undefined })} /></label>
            <label className="full"><span>模型列表 Path（可选）</span><input value={selected.modelsPath ?? ""} disabled={selected.type === "local"} placeholder="/models 或留空使用 Provider 默认路径" onChange={(event) => updateProvider(selected.id, { modelsPath: event.target.value || undefined })} /></label>
            <label><span>请求超时（秒）</span><input type="number" min="5" max="600" step="5" value={Math.round((selected.requestTimeoutMs ?? 120000) / 1000)} disabled={selected.type === "local"} onChange={(event) => updateProvider(selected.id, { requestTimeoutMs: Math.min(600000, Math.max(5000, Number(event.target.value || 120) * 1000)) })} /></label>
          </div>
          <div className="credential-note"><KeyRound size={17} /><div><strong>{selected.type === "local" ? "无需 API Key" : hasCredential ? "API Key 已配置" : keyRequired ? "API Key 尚未配置" : "API Key 可选"}</strong><span>{selected.type === "local" ? "内置本地服务不需要网络凭据。" : runtimeTarget === "desktop" ? "密钥由 Windows 系统凭据库保管，永不写入 localStorage、SQLite 工作区或导出文件。自托管和 Ollama 服务可以不配置 Key。" : "Web 模式不保存 API Key，请在桌面版中配置系统凭据。"}</span></div></div>
          <div className="credential-editor">
            <label><span>API Key</span><input type="password" value={apiKeyDraft} disabled={runtimeTarget !== "desktop" || credentialBusy || selected.type === "local"} autoComplete="new-password" placeholder={hasCredential ? "已配置，输入新值可替换" : "粘贴 Provider API Key"} onChange={(event) => setApiKeyDraft(event.target.value)} /></label>
            <div className="credential-actions"><button type="button" className="settings-action-button" disabled={runtimeTarget !== "desktop" || credentialBusy || !apiKeyDraft.trim() || selected.type === "local"} onClick={() => void saveKey()}><KeyRound size={14} />保存密钥</button><button type="button" className="settings-action-button" disabled={runtimeTarget !== "desktop" || credentialBusy || !hasCredential || selected.type === "local"} onClick={() => void clearKey()}><X size={14} />清除</button><button type="button" className="settings-action-button primary-action" disabled={runtimeTarget !== "desktop" || connectionBusy || (selected.type !== "local" && !selected.baseUrl.trim()) || (providerNeedsApiKey(selected.type, selected.baseUrl) && !hasCredential)} onClick={() => void testConnection()}>{connectionBusy ? "测试中…" : "测试连接"}</button></div>
            {connectionMessage && <p className={`connection-result ${connectionOk ? "ok" : "error"}`}>{connectionMessage}</p>}
          </div>
          <div className="model-editor">
            <div className="model-editor-heading"><div><strong>模型</strong><span>Agent 只能选择这里登记的模型</span></div><div className="model-heading-actions"><span>{selected.models.length}</span><button type="button" className="settings-action-button" disabled={modelsBusy || runtimeTarget !== "desktop" || (providerNeedsApiKey(selected.type, selected.baseUrl) && !hasCredential)} onClick={() => void refreshModels()}>{modelsBusy ? "刷新中…" : "刷新模型"}</button></div></div>
            <div className="model-list">
              {selected.models.map((model) => {
                const inUse = preferences.agents.some((agent) => agent.providerId === selected.id && agent.modelId === model);
                return <div key={model}><span>{model}</span>{inUse ? <small>使用中</small> : <button type="button" title="移除模型" onClick={() => updateProvider(selected.id, { models: selected.models.filter((item) => item !== model) })}><X size={14} /></button>}</div>;
              })}
            </div>
            <form className="inline-add" onSubmit={(event) => { event.preventDefault(); addModel(); }}><input value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} placeholder="输入模型 ID" /><button type="submit" disabled={!modelDraft.trim()}><Plus size={15} />添加模型</button></form>
          </div>
           {!selected.builtIn && <div className="detail-danger-row"><div><strong>删除提供方</strong><span>{linkedAgents ? `仍有 ${linkedAgents} 个 Agent 正在使用，需先切换。` : "此操作会同时删除系统凭据，不会删除历史消息。"}</span></div><button type="button" disabled={linkedAgents > 0} onClick={() => void deleteProvider(selected.id)}><Trash2 size={15} />删除</button></div>}
        </section>
      </div>
    </div>
  );
}

function AgentSettings() {
  const {
    preferences, activeAgent, setActiveAgent, addAgent, duplicateAgent, updateAgent, deleteAgent,
  } = useSettings();
  const [selectedId, setSelectedId] = useState(activeAgent.id);
  const selected = preferences.agents.find((agent) => agent.id === selectedId) ?? activeAgent;
  const provider = preferences.providers.find((item) => item.id === selected.providerId) ?? preferences.providers[0];

  useEffect(() => {
    if (!preferences.agents.some((agent) => agent.id === selectedId)) setSelectedId(activeAgent.id);
  }, [activeAgent.id, preferences.agents, selectedId]);

  const permissionLabels: Record<AgentPermissionMode, string> = { "read-only": "只读", ask: "询问", auto: "自动" };
  const reasoningLabels: Record<ReasoningEffort, string> = { default: "默认", none: "关闭", low: "低", medium: "中", high: "高" };
  const duplicate = () => {
    const id = duplicateAgent(selected.id);
    if (id) setSelectedId(id);
  };
  return (
    <div className="settings-page agent-settings-page">
      <header className="settings-page-header"><span>个性化助手</span><h2>Agents</h2><p>为不同工作流配置提示词、模型、权限和可用工具。</p></header>
      <div className="settings-split">
        <aside className="settings-list-pane agent-list-pane">
          <div className="settings-list-heading"><strong>我的 Agents</strong><button type="button" title="新建 Agent" onClick={() => { const id = addAgent(); setSelectedId(id); }}><Plus size={16} /></button></div>
          <div className="settings-item-list">
            {preferences.agents.map((agent) => (
              <button type="button" key={agent.id} className={agent.id === selected.id ? "active" : ""} onClick={() => setSelectedId(agent.id)}>
                <span className="agent-badge" style={{ backgroundColor: agent.color }}><Bot size={15} /></span>
                <span><strong>{agent.name}</strong><small>{agent.description || "未添加描述"}</small></span>
                {agent.id === activeAgent.id && <em>当前</em>}
              </button>
            ))}
          </div>
        </aside>
        <section className="settings-detail-pane">
          <div className="detail-title-row agent-detail-title">
            <label className="agent-color"><input type="color" value={selected.color} onChange={(event) => updateAgent(selected.id, { color: event.target.value })} aria-label="Agent 颜色" /><Bot size={20} /></label>
            <div><h3>{selected.name}</h3><span>{provider?.name ?? "未配置服务"} · {selected.modelId || "未选择模型"}</span></div>
            {selected.id === activeAgent.id ? <span className="current-agent-label"><Check size={14} />当前使用</span> : <button type="button" className="use-agent-button" onClick={() => setActiveAgent(selected.id)}>设为当前</button>}
          </div>
          <div className="settings-form-grid agent-form">
            <label><span>名称</span><input value={selected.name} onChange={(event) => updateAgent(selected.id, { name: event.target.value })} /></label>
            <label><span>描述</span><input value={selected.description} onChange={(event) => updateAgent(selected.id, { description: event.target.value })} /></label>
            <label className="full"><span>系统提示词</span><textarea rows={5} value={selected.instructions} onChange={(event) => updateAgent(selected.id, { instructions: event.target.value })} placeholder="定义这个 Agent 的角色、边界和回答方式" /></label>
            <div className="settings-form-field"><span>模型服务</span><Select value={selected.providerId} options={preferences.providers.map((item) => ({ value: item.id, label: item.name, description: item.enabled ? `${item.models.length} 个模型` : "未启用" }))} onValueChange={(providerId) => { const nextProvider = preferences.providers.find((item) => item.id === providerId); updateAgent(selected.id, { providerId, modelId: nextProvider?.models[0] ?? "" }); }} ariaLabel="模型服务" /></div>
            <div className="settings-form-field"><span>模型</span><Select value={selected.modelId} options={provider?.models.length ? provider.models.map((model) => ({ value: model, label: model })) : [{ value: "", label: "暂无模型", disabled: true }]} onValueChange={(modelId) => updateAgent(selected.id, { modelId })} ariaLabel="模型" placeholder="暂无模型" disabled={!provider?.models.length} /></div>
          </div>
          <div className="agent-control-block">
            <div className="agent-control-heading"><div><strong>创造性</strong><span>较低更稳定，较高更发散</span></div><b>{selected.temperature.toFixed(1)}</b></div>
            <input className="temperature-slider" type="range" min="0" max="2" step="0.1" value={selected.temperature} onChange={(event) => updateAgent(selected.id, { temperature: Number(event.target.value) })} />
          </div>
          <div className="agent-control-block">
            <div className="agent-control-heading"><div><strong>思考强度</strong><span>发送框可对单条消息临时覆盖</span></div><b>{reasoningLabels[selected.reasoningEffort ?? "default"]}</b></div>
            <div className="segmented-control reasoning-control">{(["default", "none", "low", "medium", "high"] as const).map((effort) => <button type="button" key={effort} className={(selected.reasoningEffort ?? "default") === effort ? "active" : ""} onClick={() => updateAgent(selected.id, { reasoningEffort: effort })}>{reasoningLabels[effort]}</button>)}</div>
          </div>
          <div className="agent-control-block">
            <div className="agent-control-heading"><div><strong>权限模式</strong><span>决定 Agent 使用工具前是否需要确认</span></div></div>
            <div className="segmented-control permission-control">{(["read-only", "ask", "auto"] as const).map((mode) => <button type="button" key={mode} className={selected.permissionMode === mode ? "active" : ""} onClick={() => updateAgent(selected.id, { permissionMode: mode })}>{permissionLabels[mode]}</button>)}</div>
          </div>
          <div className="agent-tools">
            <strong>工具能力</strong>
            <SettingsRow title="Web 搜索" detail="允许检索公开网页"><Toggle checked={selected.tools.webSearch} onChange={(webSearch) => updateAgent(selected.id, { tools: { ...selected.tools, webSearch } })} label="Web 搜索" /></SettingsRow>
            <SettingsRow title="文件读取" detail="允许读取工作区文件"><Toggle checked={selected.tools.files} onChange={(files) => updateAgent(selected.id, { tools: { ...selected.tools, files } })} label="文件读取" /></SettingsRow>
            <SettingsRow title="时间线工具" detail="允许创建分支、引用与风险"><Toggle checked={selected.tools.timeline} onChange={(timeline) => updateAgent(selected.id, { tools: { ...selected.tools, timeline } })} label="时间线工具" /></SettingsRow>
          </div>
          <div className="agent-editor-actions"><button type="button" onClick={duplicate}><Copy size={15} />复制 Agent</button><button type="button" className="delete" disabled={preferences.agents.length <= 1} onClick={() => deleteAgent(selected.id)}><Trash2 size={15} />删除</button></div>
        </section>
      </div>
    </div>
  );
}

function DataSettings() {
  const { resetPreferences } = useSettings();
  const { exportWorkspace, resetWorkspace } = useWorkspace();
  return (
    <div className="settings-page">
      <header className="settings-page-header"><span>本地优先</span><h2>数据与存储</h2><p>当前工作区保存在本机，不会自动上传到服务器。</p></header>
      <section className="storage-overview"><div><HardDrive size={22} /><span><strong>{runtimeTarget === "desktop" ? "桌面本地工作区" : "浏览器本地工作区"}</strong><small>对话与时间线：{runtimeTarget === "desktop" ? "SQLite" : "IndexedDB"} · 偏好设置：localStorage</small></span></div><em>自动保存</em></section>
      <section className="settings-group">
        <h3>工作区</h3>
        <SettingsRow title="导出工作区" detail="下载包含对话、时间线、引用和风险的 JSON 快照"><button type="button" className="settings-action-button" onClick={exportWorkspace}><Download size={15} />导出 JSON</button></SettingsRow>
          <SettingsRow title="重置本地工作区" detail="清空当前对话、时间线、引用和风险，重新开始"><button type="button" className="settings-action-button danger-outline" onClick={() => { if (window.confirm("确定要清空当前本地工作区吗？")) void resetWorkspace(); }}><RotateCcw size={15} />重置工作区</button></SettingsRow>
      </section>
      <section className="settings-group">
        <h3>偏好设置</h3>
        <SettingsRow title="恢复默认设置" detail="重置通用偏好、模型服务和 Agents，不影响对话"><button type="button" className="settings-action-button" onClick={() => { if (window.confirm("确定恢复全部默认设置吗？")) resetPreferences(); }}><RotateCcw size={15} />恢复默认</button></SettingsRow>
      </section>
    </div>
  );
}

export function SettingsDialog() {
  const { settingsOpen, settingsSection, setSettingsSection, closeSettings } = useSettings();

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeSettings(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings, settingsOpen]);

  const page = useMemo(() => {
    if (settingsSection === "providers") return <ProviderSettings />;
    if (settingsSection === "agents") return <AgentSettings />;
    if (settingsSection === "data") return <DataSettings />;
    return <GeneralSettings />;
  }, [settingsSection]);

  if (!settingsOpen) return null;
  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={closeSettings}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="settings-navigation">
          <div className="settings-brand"><div className="brand-mark">5D</div><div><strong>设置</strong><span>5DMind Desktop</span></div></div>
          <nav>{sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={settingsSection === id ? "active" : ""} title={label} aria-label={label} onClick={() => setSettingsSection(id)}><Icon size={17} /><span>{label}</span><ChevronRight size={14} /></button>)}</nav>
          <div className="settings-version"><SlidersHorizontal size={14} /><span>Prototype 0.1.0</span></div>
        </aside>
        <div className="settings-main"><button type="button" className="settings-close" title="关闭设置" onClick={closeSettings}><X size={19} /></button>{page}</div>
      </section>
    </div>
  );
}
