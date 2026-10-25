import { invoke } from "@tauri-apps/api/core";
import type { ModelProvider } from "../domain/settings";
import { isNativeRuntime } from "./runtime";

export interface ProviderConnectionResult {
  providerId: string;
  ok: boolean;
  status?: number;
  message: string;
}

function requireNative() {
  if (!isNativeRuntime) {
    throw new Error("Web 模式不会保存 API Key，请在桌面或移动端应用中配置");
  }
}

export async function listProviderCredentialStatus(providerIds: string[]): Promise<Record<string, boolean>> {
  requireNative();
  const statuses = await invoke<Array<{ providerId: string; configured: boolean }>>("list_provider_credentials", {
    providerIds,
  });
  return Object.fromEntries(statuses.map((status) => [status.providerId, status.configured]));
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  requireNative();
  await invoke("set_provider_credential", { input: { providerId, apiKey } });
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  requireNative();
  await invoke("delete_provider_credential", { providerId });
}

export async function testProviderConnection(
  provider: ModelProvider,
  model?: string,
): Promise<ProviderConnectionResult> {
  requireNative();
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
  requireNative();
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
