pub(crate) mod chat;
pub(crate) mod directory;
pub(crate) mod stream;

use reqwest::Url;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

static CREDENTIAL_QUERY_PATTERN: OnceLock<regex::Regex> = OnceLock::new();
static CREDENTIAL_JSON_PATTERN: OnceLock<regex::Regex> = OnceLock::new();
static BEARER_PATTERN: OnceLock<regex::Regex> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompleteMessageInput {
    pub(crate) timeline_id: String,
    pub(crate) content: String,
    pub(crate) parent_node_id: Option<String>,
    pub(crate) relation: Option<String>,
    pub(crate) inquiry_root_id: Option<String>,
    pub(crate) focus_selection: Option<FocusSelectionInput>,
    pub(crate) model: Option<String>,
    pub(crate) provider_id: Option<String>,
    pub(crate) provider_type: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) api_path: Option<String>,
    pub(crate) request_timeout_ms: Option<u64>,
    pub(crate) instructions: Option<String>,
    pub(crate) temperature: Option<f32>,
    pub(crate) reasoning_effort: Option<String>,
    #[serde(default)]
    pub(crate) web_search: bool,
    #[serde(default)]
    pub(crate) history: Vec<ConversationTurnInput>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusSelectionInput {
    pub(crate) source_node_id: String,
    pub(crate) text: String,
    pub(crate) start: Option<usize>,
    pub(crate) end: Option<usize>,
    pub(crate) content_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationTurnInput {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompleteMessageResponse {
    pub(crate) message_id: String,
    pub(crate) timeline_id: String,
    pub(crate) parent_node_id: Option<String>,
    pub(crate) relation: Option<String>,
    pub(crate) inquiry_root_id: Option<String>,
    pub(crate) focus_selection: Option<FocusSelectionInput>,
    pub(crate) content: String,
    pub(crate) model: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderStreamEvent {
    pub(crate) event: String,
    pub(crate) message_id: String,
    pub(crate) model: String,
    pub(crate) relation: Option<String>,
    pub(crate) inquiry_root_id: Option<String>,
    pub(crate) focus_selection: Option<FocusSelectionInput>,
    pub(crate) delta: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderConnectionInput {
    pub(crate) provider_id: String,
    pub(crate) provider_type: String,
    pub(crate) base_url: String,
    #[serde(rename = "apiPath")]
    pub(crate) _api_path: Option<String>,
    pub(crate) models_path: Option<String>,
    #[serde(rename = "model")]
    pub(crate) _model: Option<String>,
    pub(crate) request_timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderConnectionResult {
    pub(crate) provider_id: String,
    pub(crate) ok: bool,
    pub(crate) status: Option<u16>,
    pub(crate) message: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderModelsResult {
    pub(crate) provider_id: String,
    pub(crate) models: Vec<String>,
}

pub(crate) fn provider_kind(value: &str) -> &str {
    match value {
        "openai" | "anthropic" | "gemini" | "ollama" | "openai-compatible" | "local" => value,
        _ => "openai-compatible",
    }
}

pub(crate) fn provider_requires_api_key(kind: &str) -> bool {
    matches!(kind, "openai" | "anthropic" | "gemini")
}

pub(crate) fn provider_requires_api_key_for(kind: &str, base_url: &str) -> bool {
    if provider_requires_api_key(kind) {
        return true;
    }
    Url::parse(base_url)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.eq_ignore_ascii_case("api.deepseek.com"))
        })
        .unwrap_or(false)
}

pub(crate) fn normalized_url(base_url: &str) -> Result<Url, String> {
    let value = base_url.trim();
    let url = Url::parse(value).map_err(|_| "API URL 不是有效地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("API URL 必须使用 http 或 https，并包含主机名".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("API URL 不应包含账号或密码，请使用 API Key 配置".to_string());
    }
    if url
        .query_pairs()
        .any(|(key, _)| is_sensitive_query_key(&key))
    {
        return Err(
            "API URL 不应包含 API Key、Token 或密码等敏感 query，请使用 API Key 配置".to_string(),
        );
    }
    Ok(url)
}

fn is_sensitive_query_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "api_key"
            | "api-key"
            | "access_token"
            | "access-token"
            | "authorization"
            | "auth"
            | "token"
            | "secret"
            | "password"
    )
}

pub(crate) fn append_path(base_url: &str, suffix: &str) -> Result<Url, String> {
    let mut url = normalized_url(base_url)?;
    let base_path = url.path().trim_end_matches('/');
    if suffix.contains("://") {
        return Err("API Path 必须是相对路径".to_string());
    }
    let suffix = suffix.trim_start_matches('/');
    if suffix.is_empty() {
        return Ok(url);
    }
    let path = if base_path.is_empty() {
        format!("/{suffix}")
    } else {
        format!("{base_path}/{suffix}")
    };
    url.set_path(&path);
    Ok(url)
}

pub(crate) fn truncate_error(body: &str) -> String {
    let compact = redact_sensitive_text(&body.replace(['\n', '\r'], " "));
    compact.chars().take(240).collect()
}

pub(crate) fn redact_sensitive_text(value: &str) -> String {
    let query_pattern = CREDENTIAL_QUERY_PATTERN.get_or_init(|| {
        regex::Regex::new(
            r#"(?i)((?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s\"'} ,]+"#,
        )
        .expect("valid credential query redaction pattern")
    });
    let json_pattern = CREDENTIAL_JSON_PATTERN.get_or_init(|| {
        regex::Regex::new(
            r#"(?i)(\"(?:api[_-]?key|access[_-]?token|secret|password)\"\s*:\s*)\"[^\"]*\""#,
        )
        .expect("valid credential JSON redaction pattern")
    });
    let bearer_pattern = BEARER_PATTERN.get_or_init(|| {
        regex::Regex::new(r#"(?i)(bearer\s+)[A-Za-z0-9._~+/-]+=*"#)
            .expect("valid bearer redaction pattern")
    });
    let redacted = query_pattern.replace_all(value, "$1[redacted]");
    let redacted = json_pattern.replace_all(&redacted, "$1\"[redacted]\"");
    bearer_pattern
        .replace_all(&redacted, "$1[redacted]")
        .into_owned()
}

pub(crate) fn timeout_duration(value: Option<u64>, default_ms: u64) -> Duration {
    Duration::from_millis(value.unwrap_or(default_ms).clamp(5_000, 600_000))
}

pub(crate) fn validated_relation(
    relation: Option<&str>,
    selection: Option<&FocusSelectionInput>,
) -> Result<Option<String>, String> {
    let relation = relation.map(str::trim).filter(|value| !value.is_empty());
    match relation {
        None if selection.is_some() => Ok(Some("focused-inquiry".to_string())),
        None => Ok(None),
        Some("main") | Some("branch") => {
            if selection.is_some() {
                Err("普通消息不能携带选区追问数据".to_string())
            } else {
                Ok(relation.map(ToOwned::to_owned))
            }
        }
        Some("focused-inquiry") => {
            let selection = selection.ok_or_else(|| "选区追问缺少 focusSelection".to_string())?;
            if selection.source_node_id.trim().is_empty()
                || selection.text.trim().is_empty()
                || selection.content_hash.trim().is_empty()
            {
                return Err("选区追问的来源节点、文本和内容哈希不能为空".to_string());
            }
            if let (Some(start), Some(end)) = (selection.start, selection.end) {
                if start > end {
                    return Err("选区追问的起止位置无效".to_string());
                }
            }
            Ok(Some("focused-inquiry".to_string()))
        }
        Some(other) => Err(format!("不支持的消息关系：{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_provider_urls_that_can_leak_credentials() {
        assert!(normalized_url("file:///tmp/provider").is_err());
        assert!(normalized_url("https://user:pass@example.com/v1").is_err());
        assert!(normalized_url("https://api.example.com/v1?api_key=secret").is_err());
        assert!(normalized_url("https://api.example.com/v1?api-version=2024-01-01").is_ok());
        assert!(normalized_url("https://api.example.com/v1").is_ok());
    }

    #[test]
    fn validates_message_relation_and_selection_shape() {
        assert!(validated_relation(Some("unknown"), None).is_err());
        assert!(validated_relation(Some("focused-inquiry"), None).is_err());
        assert!(
            validated_relation(
                Some("focused-inquiry"),
                Some(&FocusSelectionInput {
                    source_node_id: "source".to_string(),
                    text: "selection".to_string(),
                    start: Some(3),
                    end: Some(2),
                    content_hash: "hash".to_string(),
                })
            )
            .is_err()
        );
    }

    #[test]
    fn treats_self_hosted_provider_keys_as_optional() {
        assert!(provider_requires_api_key("openai"));
        assert!(provider_requires_api_key("anthropic"));
        assert!(provider_requires_api_key("gemini"));
        assert!(!provider_requires_api_key("openai-compatible"));
        assert!(!provider_requires_api_key("ollama"));
        assert!(provider_requires_api_key_for(
            "openai-compatible",
            "https://api.deepseek.com"
        ));
        assert!(!provider_requires_api_key_for(
            "openai-compatible",
            "http://127.0.0.1:1234/v1"
        ));
    }

    #[test]
    fn redacts_credentials_from_provider_diagnostics() {
        let text = redact_sensitive_text(
            r#"request failed: https://api.example.test?api_key=secret-key&model=qwen; Authorization: Bearer sk-secret"#,
        );
        assert!(!text.contains("secret-key"));
        assert!(!text.contains("sk-secret"));
        assert!(text.contains("model=qwen"));
    }
}
