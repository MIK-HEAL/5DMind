import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile, ModelProvider, SettingsSection, UserPreferences } from "../domain/settings";
import { defaultPreferences, settingsRepository } from "../infrastructure/settingsRepository";
import { isNativeRuntime } from "../infrastructure/runtime";
import {
  deleteProviderApiKey,
  listProviderCredentialStatus,
  listProviderModels,
  saveProviderApiKey,
  testProviderConnection,
  type ProviderConnectionResult,
} from "../infrastructure/providerCredentials";

interface SettingsContextValue {
  preferences: UserPreferences;
  activeAgent: AgentProfile;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  setActiveAgent: (agentId: string) => void;
  addProvider: () => string;
  updateProvider: (providerId: string, patch: Partial<ModelProvider>) => void;
  deleteProvider: (providerId: string) => Promise<void>;
  addAgent: () => string;
  duplicateAgent: (agentId: string) => string | undefined;
  updateAgent: (agentId: string, patch: Partial<AgentProfile>) => void;
  deleteAgent: (agentId: string) => void;
  resetPreferences: () => void;
  providerCredentialStatus: Record<string, boolean>;
  saveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  clearProviderApiKey: (providerId: string) => Promise<void>;
  testProviderConnection: (providerId: string, model?: string) => Promise<ProviderConnectionResult>;
  refreshProviderModels: (providerId: string) => Promise<string[]>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => settingsRepository.load());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [providerCredentialStatus, setProviderCredentialStatus] = useState<Record<string, boolean>>({});
  const providerIds = preferences.providers.map((provider) => provider.id).join("|");

  useEffect(() => {
    settingsRepository.save(preferences);
    document.documentElement.dataset.messageSize = preferences.messageFontSize;
  }, [preferences]);

  useEffect(() => {
    if (!isNativeRuntime) return;
    let active = true;
    void listProviderCredentialStatus(providerIds.split("|").filter(Boolean))
      .then((status) => {
        if (active) setProviderCredentialStatus(status);
      })
      .catch(() => {
        if (active) setProviderCredentialStatus({});
      });
    return () => {
      active = false;
    };
  }, [providerIds]);

  const openSettings = useCallback((section: SettingsSection = "general") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const setActiveAgent = useCallback((agentId: string) => {
    setPreferences((current) =>
      current.agents.some((agent) => agent.id === agentId) ? { ...current, activeAgentId: agentId } : current,
    );
  }, []);

  const addProvider = useCallback(() => {
    const id = makeId("provider");
    setPreferences((current) => ({
      ...current,
      providers: [
        ...current.providers,
        {
          id,
          name: "自定义服务",
          type: "openai-compatible",
          enabled: false,
          baseUrl: "",
          models: [],
          requestTimeoutMs: 120000,
        },
      ],
    }));
    return id;
  }, []);

  const updateProvider = useCallback((providerId: string, patch: Partial<ModelProvider>) => {
    setPreferences((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, ...patch } : provider),
      agents: current.agents.map((agent) => {
        if (agent.providerId !== providerId) return agent;
        const nextModels = patch.models ?? current.providers.find((provider) => provider.id === providerId)?.models ?? [];
        return nextModels.includes(agent.modelId) ? agent : { ...agent, modelId: nextModels[0] ?? "" };
      }),
    }));
  }, []);

  const deleteProvider = useCallback(
    async (providerId: string) => {
      const provider = preferences.providers.find((item) => item.id === providerId);
      if (!provider || provider.builtIn || preferences.agents.some((agent) => agent.providerId === providerId)) return;
      if (isNativeRuntime) await deleteProviderApiKey(providerId);
      setPreferences((current) => ({
        ...current,
        providers: current.providers.filter((item) => item.id !== providerId),
      }));
      setProviderCredentialStatus((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
    },
    [preferences.agents, preferences.providers],
  );

  const addAgent = useCallback(() => {
    const id = makeId("agent");
    setPreferences((current) => {
      const provider = current.providers.find((item) => item.enabled) ?? current.providers[0];
      const agent: AgentProfile = {
        id,
        name: "新 Agent",
        description: "",
        instructions: "",
        providerId: provider.id,
        modelId: provider.models[0] ?? "",
        temperature: 0.7,
        reasoningEffort: "default",
        permissionMode: "ask",
        tools: { webSearch: false, files: true, timeline: true },
        color: "#7a5ba6",
      };
      return { ...current, agents: [...current.agents, agent] };
    });
    return id;
  }, []);

  const duplicateAgent = useCallback(
    (agentId: string) => {
      const source = preferences.agents.find((agent) => agent.id === agentId);
      if (!source) return undefined;
      const id = makeId("agent");
      setPreferences((current) => {
        return {
          ...current,
          agents: [...current.agents, { ...structuredClone(source), id, name: `${source.name} 副本` }],
        };
      });
      return id;
    },
    [preferences.agents],
  );

  const updateAgent = useCallback((agentId: string, patch: Partial<AgentProfile>) => {
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "id")) as Partial<AgentProfile>;
    setPreferences((current) => ({
      ...current,
      agents: current.agents.map((agent) => (agent.id === agentId ? { ...agent, ...safePatch } : agent)),
    }));
  }, []);

  const deleteAgent = useCallback((agentId: string) => {
    setPreferences((current) => {
      if (current.agents.length <= 1) return current;
      const agents = current.agents.filter((agent) => agent.id !== agentId);
      return {
        ...current,
        agents,
        activeAgentId: current.activeAgentId === agentId ? agents[0].id : current.activeAgentId,
      };
    });
  }, []);

  const resetPreferences = useCallback(() => setPreferences(settingsRepository.reset()), []);

  const saveApiKey = useCallback(async (providerId: string, apiKey: string) => {
    await saveProviderApiKey(providerId, apiKey);
    setProviderCredentialStatus((current) => ({ ...current, [providerId]: true }));
  }, []);

  const clearApiKey = useCallback(async (providerId: string) => {
    await deleteProviderApiKey(providerId);
    setProviderCredentialStatus((current) => ({ ...current, [providerId]: false }));
  }, []);

  const checkProvider = useCallback(
    async (providerId: string, model?: string) => {
      const provider = preferences.providers.find((item) => item.id === providerId);
      if (!provider) throw new Error("Provider 不存在");
      return testProviderConnection(provider, model);
    },
    [preferences.providers],
  );

  const refreshModels = useCallback(
    async (providerId: string) => {
      const provider = preferences.providers.find((item) => item.id === providerId);
      if (!provider) throw new Error("Provider 不存在");
      const models = await listProviderModels(provider);
      setPreferences((current) =>
        current.providers.some((item) => item.id === providerId)
          ? {
              ...current,
              providers: current.providers.map((item) => (item.id === providerId ? { ...item, models } : item)),
            }
          : current,
      );
      return models;
    },
    [preferences.providers],
  );

  const activeAgent = useMemo(
    () =>
      preferences.agents.find((agent) => agent.id === preferences.activeAgentId) ??
      preferences.agents[0] ??
      defaultPreferences.agents[0],
    [preferences.activeAgentId, preferences.agents],
  );

  const value: SettingsContextValue = {
    preferences,
    activeAgent,
    settingsOpen,
    settingsSection,
    openSettings,
    closeSettings,
    setSettingsSection,
    updatePreferences,
    setActiveAgent,
    addProvider,
    updateProvider,
    deleteProvider,
    addAgent,
    duplicateAgent,
    updateAgent,
    deleteAgent,
    resetPreferences,
    providerCredentialStatus,
    saveProviderApiKey: saveApiKey,
    clearProviderApiKey: clearApiKey,
    testProviderConnection: checkProvider,
    refreshProviderModels: refreshModels,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
