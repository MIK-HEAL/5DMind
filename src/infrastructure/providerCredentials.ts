import { invoke } from "@tauri-apps/api/core";
import type { ModelProvider } from "../domain/settings";
import { runtimeTarget } from "./runtime";

export interface ProviderConnectionResult {
  providerId: string;
  ok: boolean;
  status?: number;
  message: string;
}

function requireDesktop() {
  if (runtimeTarget !== "desktop") {
    throw new Error("系统凭据仅在桌面版可用；Web 模式不会保存 API Key");
  }
}

export async function listProviderCredentialStatus(providerIds: string[]): Promise<Record<string, boolean>> {
  requireDesktop();
  const statuses = await invoke<Array<{ providerId: string; configured: boolean }>>(
    "list_provider_credentials",
    { providerIds },
  );
  return Object.fromEntries(statuses.map((status) => [status.providerId, status.configured]));
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  requireDesktop();
  await invoke("set_provider_credential", { input: { providerId, apiKey } });
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  requireDesktop();
  await invoke("delete_provider_credential", { providerId });
}

export async function testProviderConnection(provider: ModelProvider, model?: string): Promise<ProviderConnectionResult> {
  requireDesktop();
  return invoke<ProviderConnectionResult>("test_provider_connection", {
    input: {
      providerId: provider.id,
      providerType: provider.type,
      baseUrl: provider.baseUrl,
      apiPath: provider.apiPath,
      modelsPath: provider.modelsPath,
      model: model || provider.models[0],
      requestTimeoutMs: provider.requestTimeoutMs,
    },
  });
}

export async function listProviderModels(provider: ModelProvider): Promise<string[]> {
  requireDesktop();
  const result = await invoke<{ providerId: string; models: string[] }>("list_provider_models", {
    input: {
      providerId: provider.id,
      providerType: provider.type,
      baseUrl: provider.baseUrl,
      apiPath: provider.apiPath,
      modelsPath: provider.modelsPath,
      model: provider.models[0],
      requestTimeoutMs: provider.requestTimeoutMs,
    },
  });
  return result.models;
}
