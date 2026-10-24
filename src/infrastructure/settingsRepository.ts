import type { ModelProvider, UserPreferences } from "../domain/settings";

const SETTINGS_KEY = "5dmind.preferences.v2";

const SENSITIVE_QUERY_KEY = /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|token|secret|password)$/i;

export function sanitizeProviderUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    const serialized = url.toString();
    const hadExplicitRootSlash = /^https?:\/\/[^/?#]+\/(?:[?#]|$)/i.test(trimmed);
    if (url.pathname === "/" && !hadExplicitRootSlash) {
      return `${url.origin}${url.search}${url.hash}`;
    }
    return serialized;
  } catch {
    return trimmed;
  }
}

export const defaultPreferences: UserPreferences = {
  version: 1,
  profileName: "Johnny",
  language: "zh-CN",
  messageFontSize: "medium",
  sendWithEnter: true,
  showTimestamps: true,
  activeAgentId: "agent-general",
  providers: [
    {
      id: "provider-local",
      name: "本地模型",
      type: "local",
      enabled: true,
      baseUrl: "",
      models: ["5D Local Gateway"],
      builtIn: true,
    },
    {
      id: "provider-openai",
      name: "OpenAI",
      type: "openai",
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-5", "gpt-4.1"],
      builtIn: true,
    },
    {
      id: "provider-anthropic",
      name: "Anthropic",
      type: "anthropic",
      enabled: false,
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet", "claude-opus"],
      builtIn: true,
    },
    {
      id: "provider-ollama",
      name: "Ollama",
      type: "ollama",
      enabled: false,
      baseUrl: "http://127.0.0.1:11434",
      models: ["qwen3", "llama3.2"],
      builtIn: true,
    },
  ],
  agents: [
    {
      id: "agent-general",
      name: "5D 助手",
      description: "清晰、克制的通用对话助手",
      instructions: "优先理解用户当前目标，给出可执行的答案。需要探索替代方案时，明确指出适合建立时间线分支的位置。",
      providerId: "provider-local",
      modelId: "5D Local Gateway",
      temperature: 0.7,
      reasoningEffort: "default",
      permissionMode: "ask",
      tools: { webSearch: false, files: true, timeline: true },
      color: "#206b5a",
    },
    {
      id: "agent-research",
      name: "研究分析师",
      description: "整理证据、假设与待验证问题",
      instructions: "将结论与证据分开表达，主动标记假设、矛盾和信息缺口。引用其他时间线时保留来源。",
      providerId: "provider-local",
      modelId: "5D Local Gateway",
      temperature: 0.4,
      reasoningEffort: "default",
      permissionMode: "read-only",
      tools: { webSearch: true, files: true, timeline: true },
      color: "#4b67b0",
    },
    {
      id: "agent-risk",
      name: "风险审查员",
      description: "寻找冲突、遗漏和不可逆决策",
      instructions: "检查当前方案中的依赖、风险和反例。高影响的不确定项应创建风险标记，并给出验证或解除条件。",
      providerId: "provider-local",
      modelId: "5D Local Gateway",
      temperature: 0.2,
      reasoningEffort: "default",
      permissionMode: "read-only",
      tools: { webSearch: false, files: true, timeline: true },
      color: "#b85240",
    },
  ],
};

function cloneDefaults() {
  return structuredClone(defaultPreferences);
}

// Provider settings are intentionally allow-listed before persistence. This
// also scrubs apiKey-like fields left by older prototypes or imported JSON.
function sanitizeProvider(provider: ModelProvider): ModelProvider {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: Boolean(provider.enabled),
    baseUrl: sanitizeProviderUrl(provider.baseUrl),
    models: Array.isArray(provider.models) ? provider.models.filter((model) => typeof model === "string") : [],
    ...(provider.apiPath ? { apiPath: provider.apiPath } : {}),
    ...(provider.modelsPath ? { modelsPath: provider.modelsPath } : {}),
    ...(Number.isFinite(provider.requestTimeoutMs) ? { requestTimeoutMs: provider.requestTimeoutMs } : {}),
    ...(provider.builtIn ? { builtIn: true } : {}),
  };
}

export const settingsRepository = {
  load(): UserPreferences {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (!stored) return cloneDefaults();
      const parsed = JSON.parse(stored) as Partial<UserPreferences>;
      if (parsed.version !== 1 || !Array.isArray(parsed.providers) || !Array.isArray(parsed.agents)) {
        return cloneDefaults();
      }
      const merged = { ...cloneDefaults(), ...parsed } as UserPreferences;
      merged.providers = merged.providers.map(sanitizeProvider);
      const localProvider = merged.providers.find((provider) => provider.type === "local");
      if (localProvider) {
        localProvider.enabled = true;
        if (!localProvider.models.length) localProvider.models = ["5D Local Gateway"];
        merged.agents = merged.agents.map((agent) =>
          agent.providerId === localProvider.id && !agent.modelId
            ? { ...agent, modelId: localProvider.models[0] }
            : agent,
        );
      }
      if (!merged.agents.some((agent) => agent.id === merged.activeAgentId)) {
        merged.activeAgentId = merged.agents[0]?.id ?? defaultPreferences.activeAgentId;
      }
      return merged;
    } catch {
      return cloneDefaults();
    }
  },

  save(preferences: UserPreferences) {
    const safePreferences = {
      ...preferences,
      providers: preferences.providers.map(sanitizeProvider),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safePreferences));
  },

  reset() {
    const preferences = cloneDefaults();
    this.save(preferences);
    return preferences;
  },
};
