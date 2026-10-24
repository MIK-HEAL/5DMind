export type SettingsSection = "general" | "providers" | "agents" | "data";
export type ProviderType = "local" | "openai" | "anthropic" | "gemini" | "ollama" | "openai-compatible";
export type AgentPermissionMode = "ask" | "auto" | "read-only";
export type ReasoningEffort = "default" | "none" | "low" | "medium" | "high";

export interface ModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  baseUrl: string;
  models: string[];
  apiKeyConfigured?: boolean;
  apiPath?: string;
  modelsPath?: string;
  requestTimeoutMs?: number;
  builtIn?: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  providerId: string;
  modelId: string;
  temperature: number;
  reasoningEffort?: ReasoningEffort;
  permissionMode: AgentPermissionMode;
  tools: {
    webSearch: boolean;
    files: boolean;
    timeline: boolean;
  };
  color: string;
}

export interface UserPreferences {
  version: 1;
  profileName: string;
  language: "zh-CN" | "en-US";
  messageFontSize: "small" | "medium" | "large";
  sendWithEnter: boolean;
  showTimestamps: boolean;
  activeAgentId: string;
  providers: ModelProvider[];
  agents: AgentProfile[];
}
