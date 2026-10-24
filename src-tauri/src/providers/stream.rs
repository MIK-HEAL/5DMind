use reqwest::Client;
use crate::credentials::provider_api_key;
use crate::providers::{
    CompleteMessageInput, ProviderStreamEvent, provider_kind, provider_requires_api_key_for,
    redact_sensitive_text, timeout_duration, truncate_error,
};
use crate::providers::chat::{chat_stream_url, remote_body, response_text};
use crate::search::web_search_context;

fn stream_line_delta(provider_type: &str, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty()
        || line.starts_with(':')
        || line.starts_with("event:")
        || line.starts_with("id:")
    {
        return None;
    }
    let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    let paths: &[&[&str]] = match provider_type {
        "anthropic" => &[&["delta", "text"], &["content"]],
        "gemini" => &[&["candidates", "0", "content", "parts"]],
        "ollama" => &[&["message", "content"], &["response"]],
        _ => &[
            &["choices", "0", "delta", "content"],
            &["choices", "0", "message", "content"],
            &["content"],
        ],
    };
    response_text(&value, paths).filter(|delta| !delta.is_empty())
}

fn stream_line_reasoning(provider_type: &str, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
        return None;
    }
    let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
    if payload.is_empty() || payload == "[DONE]" { return None; }
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    let paths: &[&[&str]] = match provider_type {
        "anthropic" => &[&["delta", "thinking"], &["delta", "reasoning_content"]],
        _ => &[&["choices", "0", "delta", "reasoning_content"], &["choices", "0", "delta", "reasoning"], &["choices", "0", "delta", "thinking"], &["reasoning_content"], &["reasoning"]],
    };
    response_text(&value, paths).filter(|delta| !delta.is_empty())
}

pub(crate) fn emit_stream_event(
    channel: &tauri::ipc::Channel<ProviderStreamEvent>,
    event: ProviderStreamEvent,
) -> Result<(), String> {
    channel
        .send(event)
        .map_err(|error| format!("桌面流式通道已关闭：{error}"))
}

pub(crate) async fn complete_remote_stream(
    input: &CompleteMessageInput,
    channel: &tauri::ipc::Channel<ProviderStreamEvent>,
    message_id: &str,
    model: &str,
) -> Result<String, String> {
    let provider_id = input
        .provider_id
        .as_deref()
        .ok_or_else(|| "Provider ID 缺失".to_string())?;
    let provider_type = provider_kind(
        input
            .provider_type
            .as_deref()
            .unwrap_or("openai-compatible"),
    );
    let api_key = provider_api_key(provider_id)?;
    if provider_requires_api_key_for(provider_type, input.base_url.as_deref().unwrap_or_default())
        && api_key.is_none()
    {
        return Err("尚未配置 API Key，请在设置中保存后重试".to_string());
    }
    let url = chat_stream_url(input)?;
    let client = Client::builder()
        .timeout(timeout_duration(input.request_timeout_ms, 120_000))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))?;
    let web_context = web_search_context(input).await?;
    let body = remote_body(input, provider_type, model, true, &web_context);
    let request = crate::providers::chat::with_provider_auth(
        client.post(url).json(&body),
        provider_type,
        api_key.as_deref(),
    );
    let mut response = request.send().await.map_err(|error| {
        format!(
            "调用 Provider 失败：{}",
            redact_sensitive_text(&error.to_string())
        )
    })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Provider 返回 HTTP {}：{}",
            status.as_u16(),
            truncate_error(&body)
        ));
    }

    let mut pending = Vec::new();
    let mut content = String::new();
    let mut reasoning_started = false;
    let mut reasoning_closed = false;
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        format!(
            "读取 Provider 流失败：{}",
            redact_sensitive_text(&error.to_string())
        )
    })? {
        pending.extend_from_slice(&chunk);
        while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
            let line = pending.drain(..=index).collect::<Vec<_>>();
            let line =
                String::from_utf8(line).map_err(|_| "Provider 流包含无效 UTF-8".to_string())?;
            if let Some(delta) = stream_line_reasoning(provider_type, &line) {
                let output = if reasoning_started { delta } else { reasoning_started = true; format!("<think>{delta}") };
                content.push_str(&output);
                emit_stream_event(channel, ProviderStreamEvent { event: "delta".to_string(), message_id: message_id.to_string(), model: model.to_string(), relation: None, inquiry_root_id: None, focus_selection: None, delta: Some(output), error: None })?;
            } else if let Some(delta) = stream_line_delta(provider_type, &line) {
                let output = if reasoning_started && !reasoning_closed { reasoning_closed = true; format!("</think>{delta}") } else { delta };
                content.push_str(&output);
                emit_stream_event(
                    channel,
                    ProviderStreamEvent {
                        event: "delta".to_string(),
                        message_id: message_id.to_string(),
                        model: model.to_string(),
                        relation: None,
                        inquiry_root_id: None,
                        focus_selection: None,
                        delta: Some(output),
                        error: None,
                    },
                )?;
            }
        }
    }
    if !pending.is_empty() {
        let line =
            String::from_utf8(pending).map_err(|_| "Provider 流包含无效 UTF-8".to_string())?;
        if let Some(delta) = stream_line_reasoning(provider_type, &line) {
            let output = if reasoning_started { delta } else { reasoning_started = true; format!("<think>{delta}") };
            content.push_str(&output);
            emit_stream_event(channel, ProviderStreamEvent { event: "delta".to_string(), message_id: message_id.to_string(), model: model.to_string(), relation: None, inquiry_root_id: None, focus_selection: None, delta: Some(output), error: None })?;
        } else if let Some(delta) = stream_line_delta(provider_type, &line) {
            let output = if reasoning_started && !reasoning_closed { reasoning_closed = true; format!("</think>{delta}") } else { delta };
            content.push_str(&output);
            emit_stream_event(
                channel,
                ProviderStreamEvent {
                    event: "delta".to_string(),
                    message_id: message_id.to_string(),
                    model: model.to_string(),
                    relation: None,
                    inquiry_root_id: None,
                    focus_selection: None,
                    delta: Some(output),
                    error: None,
                },
            )?;
        }
    }
    if reasoning_started && !reasoning_closed {
        content.push_str("</think>");
        emit_stream_event(channel, ProviderStreamEvent { event: "delta".to_string(), message_id: message_id.to_string(), model: model.to_string(), relation: None, inquiry_root_id: None, focus_selection: None, delta: Some("</think>".to_string()), error: None })?;
    }
    if content.is_empty() {
        return Err("Provider 流中没有文本内容".to_string());
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_native_provider_stream_deltas() {
        assert_eq!(
            stream_line_delta(
                "openai-compatible",
                r#"data: {"choices":[{"delta":{"content":"hi"}}]}"#
            ),
            Some("hi".to_string())
        );
        assert_eq!(
            stream_line_delta("anthropic", r#"data: {"delta":{"text":"there"}}"#),
            Some("there".to_string())
        );
        assert_eq!(
            stream_line_delta(
                "gemini",
                r#"data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}]}"#
            ),
            Some("!".to_string())
        );
        assert_eq!(
            stream_line_delta("ollama", r#"{"message":{"content":"ok"},"done":false}"#),
            Some("ok".to_string())
        );
        assert_eq!(stream_line_delta("openai-compatible", "data: [DONE]"), None);
    }
}
