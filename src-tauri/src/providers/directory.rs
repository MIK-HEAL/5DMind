use reqwest::{Client, StatusCode, Url};
use crate::credentials::{provider_api_key, validate_provider_id};
use crate::providers::{
    ProviderConnectionInput, ProviderConnectionResult, ProviderModelsResult, append_path,
    provider_kind, provider_requires_api_key_for, redact_sensitive_text, timeout_duration,
    truncate_error,
};

pub(crate) fn models_url(input: &ProviderConnectionInput) -> Result<Url, String> {
    let kind = provider_kind(&input.provider_type);
    let base = input.base_url.trim_end_matches('/');
    if let Some(path) = input
        .models_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return append_path(base, path);
    }
    match kind {
        "anthropic" => {
            if base.ends_with("/v1") {
                append_path(base, "models")
            } else {
                append_path(base, "v1/models")
            }
        }
        "gemini" => {
            if base.ends_with("/v1beta") {
                append_path(base, "models")
            } else {
                append_path(base, "v1beta/models")
            }
        }
        "ollama" => {
            if base.ends_with("/api") {
                append_path(base, "tags")
            } else {
                append_path(base, "api/tags")
            }
        }
        _ => append_path(base, "models"),
    }
}

async fn provider_get(input: &ProviderConnectionInput) -> Result<(StatusCode, String), String> {
    if provider_kind(&input.provider_type) == "local" {
        return Ok((StatusCode::OK, "本地 ModelGateway 已就绪".to_string()));
    }
    let url = models_url(input)?;
    let client = Client::builder()
        .timeout(timeout_duration(input.request_timeout_ms, 15_000))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))?;
    let api_key = provider_api_key(&input.provider_id)?;
    let kind = provider_kind(&input.provider_type);
    if provider_requires_api_key_for(kind, &input.base_url) && api_key.is_none() {
        return Err("尚未配置 API Key，请在设置中保存后重试".to_string());
    }
    let mut request = client.get(url);
    if kind == "gemini" {
        request = request.header("x-goog-api-key", api_key.as_deref().unwrap_or_default());
    } else if kind == "anthropic" {
        request = request
            .header("x-api-key", api_key.as_deref().unwrap_or_default())
            .header("anthropic-version", "2023-06-01");
    } else if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await.map_err(|error| {
        format!(
            "连接 Provider 失败：{}",
            redact_sensitive_text(&error.to_string())
        )
    })?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Ok((status, body))
}

pub(crate) fn model_ids(provider_type: &str, body: &str) -> Vec<String> {
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let kind = provider_kind(provider_type);
    let values = match kind {
        "gemini" => payload.get("models").and_then(serde_json::Value::as_array),
        "ollama" => payload.get("models").and_then(serde_json::Value::as_array),
        _ => payload.get("data").and_then(serde_json::Value::as_array),
    };
    values
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let value = item.get("id").or_else(|| item.get("name"))?.as_str()?;
            Some(value.strip_prefix("models/").unwrap_or(value).to_string())
        })
        .filter(|value| !value.trim().is_empty())
        .collect()
}

#[tauri::command]
pub(crate) async fn list_provider_models(
    input: ProviderConnectionInput,
) -> Result<ProviderModelsResult, String> {
    validate_provider_id(&input.provider_id)?;
    if provider_kind(&input.provider_type) == "local" {
        return Ok(ProviderModelsResult {
            provider_id: input.provider_id,
            models: vec!["5D Local Gateway".to_string()],
        });
    }
    let (status, body) = provider_get(&input).await?;
    if !status.is_success() {
        return Err(format!(
            "Provider 返回 HTTP {}：{}",
            status.as_u16(),
            truncate_error(&body)
        ));
    }
    let models = model_ids(&input.provider_type, &body);
    if models.is_empty() {
        return Err("Provider 已连接，但没有返回可识别的模型列表".to_string());
    }
    Ok(ProviderModelsResult {
        provider_id: input.provider_id,
        models,
    })
}

#[tauri::command]
pub(crate) async fn test_provider_connection(
    input: ProviderConnectionInput,
) -> Result<ProviderConnectionResult, String> {
    validate_provider_id(&input.provider_id)?;
    if provider_kind(&input.provider_type) == "local" {
        return Ok(ProviderConnectionResult {
            provider_id: input.provider_id,
            ok: true,
            status: Some(200),
            message: "本地 ModelGateway 已就绪".to_string(),
        });
    }
    let (status, body) = provider_get(&input).await?;
    let message = if status.is_success() {
        "连接成功，Provider 已返回模型目录".to_string()
    } else {
        format!(
            "Provider 返回 HTTP {}：{}",
            status.as_u16(),
            truncate_error(&body)
        )
    };
    Ok(ProviderConnectionResult {
        provider_id: input.provider_id,
        ok: status.is_success(),
        status: Some(status.as_u16()),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_catalogs_for_supported_provider_shapes() {
        assert_eq!(
            model_ids("openai", r#"{"data":[{"id":"gpt-5"}] }"#),
            vec!["gpt-5"]
        );
        assert_eq!(
            model_ids(
                "gemini",
                r#"{"models":[{"name":"models/gemini-2.5-flash"}] }"#
            ),
            vec!["gemini-2.5-flash"]
        );
        assert_eq!(
            model_ids("ollama", r#"{"models":[{"name":"qwen3"}] }"#),
            vec!["qwen3"]
        );
    }

    #[test]
    fn supports_a_custom_model_catalog_path() {
        let input = ProviderConnectionInput {
            provider_id: "provider-custom".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: "https://gateway.example.test/v1".to_string(),
            _api_path: None,
            models_path: Some("/catalog/models".to_string()),
            _model: None,
            request_timeout_ms: None,
        };
        assert_eq!(
            models_url(&input).expect("catalog URL").as_str(),
            "https://gateway.example.test/v1/catalog/models"
        );
    }
}
