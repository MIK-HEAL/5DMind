import { beforeEach, describe, expect, it } from "vitest";
import { defaultPreferences, sanitizeProviderUrl, settingsRepository } from "./settingsRepository";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("settingsRepository", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createStorage(),
    });
  });

  it("loads an independent copy of the defaults", () => {
    const preferences = settingsRepository.load();
    expect(preferences.activeAgentId).toBe(defaultPreferences.activeAgentId);
    expect(preferences.providers.length).toBeGreaterThan(1);
    preferences.agents[0].name = "临时修改";
    expect(defaultPreferences.agents[0].name).not.toBe("临时修改");
  });

  it("round-trips custom preferences", () => {
    const preferences = settingsRepository.load();
    preferences.profileName = "本地研究员";
    preferences.messageFontSize = "large";
    settingsRepository.save(preferences);

    expect(settingsRepository.load()).toMatchObject({
      profileName: "本地研究员",
      messageFontSize: "large",
    });
  });

  it("scrubs legacy API key fields before writing provider settings", () => {
    const preferences = settingsRepository.load();
    const provider = preferences.providers[0] as (typeof preferences.providers)[number] & { apiKey?: string };
    provider.apiKey = "should-not-be-persisted";
    provider.modelsPath = "/v1/models";
    settingsRepository.save(preferences);

    const stored = localStorage.getItem("5dmind.preferences.v2") ?? "";
    expect(stored).not.toContain("should-not-be-persisted");
    expect(settingsRepository.load().providers[0].modelsPath).toBe("/v1/models");
  });

  it("falls back when stored data has an unsupported version", () => {
    localStorage.setItem("5dmind.preferences.v2", JSON.stringify({ version: 99, providers: [], agents: [] }));
    expect(settingsRepository.load()).toEqual(defaultPreferences);
  });

  it("repairs malformed agents and dangling provider/model references", () => {
    const defaults = settingsRepository.load();
    localStorage.setItem("5dmind.preferences.v2", JSON.stringify({
      ...defaults,
      activeAgentId: "missing",
      agents: [{
        id: "broken",
        name: "损坏 Agent",
        providerId: "missing-provider",
        modelId: "missing-model",
        temperature: 99,
        tools: { webSearch: true },
      }],
    }));

    const repaired = settingsRepository.load();
    expect(repaired.activeAgentId).toBe("broken");
    expect(repaired.agents[0]).toMatchObject({
      providerId: "provider-local",
      modelId: "5D Local Gateway",
      temperature: 2,
      permissionMode: "ask",
      tools: { webSearch: true, files: true, timeline: true },
    });
  });

  it("restores the default agent set when stored agents are empty", () => {
    const defaults = settingsRepository.load();
    localStorage.setItem("5dmind.preferences.v2", JSON.stringify({ ...defaults, agents: [], activeAgentId: "missing" }));
    const repaired = settingsRepository.load();
    expect(repaired.agents.length).toBe(defaultPreferences.agents.length);
    expect(repaired.activeAgentId).toBe(defaultPreferences.activeAgentId);
  });

  it("removes credential query parameters while preserving non-secret provider options", () => {
    expect(sanitizeProviderUrl("https://api.example.com/v1?api_key=secret&api-version=2024-01-01")).toBe(
      "https://api.example.com/v1?api-version=2024-01-01",
    );
  });

  it("does not append a slash to a bare provider host", () => {
    expect(sanitizeProviderUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com");
    expect(sanitizeProviderUrl("https://api.deepseek.com?api-version=2025-01-01")).toBe(
      "https://api.deepseek.com?api-version=2025-01-01",
    );
  });
});
