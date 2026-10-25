use reqwest::{Client, Url};
use serde_json::Value;
use crate::credentials::provider_api_key;
use crate::providers::{
    AttachmentInput, CompleteMessageInput, append_path, provider_kind, provider_requires_api_key_for,
    redact_sensitive_text, timeout_duration, truncate_error,
};
use crate::search::web_search_context;

pub(crate) fn chat_url(input: &CompleteMessageInput) -> Result<Url, String> {
    let base = input
        .base_url
        .as_deref()
        .ok_or_else(|| "Provider 尚未配置 API URL".to_string())?
        .trim_end_matches('/');
    if let Some(path) = input
        .api_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return append_path(base, path);
    }
    match provider_kind(input.provider_type.as_deref().unwrap_or("local")) {
        "anthropic" => {
            if base.ends_with("/v1") {
                append_path(base, "messages")
            } else {
                append_path(base, "v1/messages")
            }
        }
        "gemini" => {
            let model = input
                .model
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Gemini 尚未选择模型".to_string())?;
            if base.ends_with("/v1beta") {
                append_path(base, &format!("models/{model}:generateContent"))
            } else {
                append_path(base, &format!("v1beta/models/{model}:generateContent"))
            }
        }
        "ollama" => {
            if base.ends_with("/api") {
                append_path(base, "chat")
            } else {
                append_path(base, "api/chat")
            }
        }
        _ => append_path(base, "chat/completions"),
    }
}

pub(crate) fn chat_stream_url(input: &CompleteMessageInput) -> Result<Url, String> {
    let mut url = chat_url(input)?;
    if provider_kind(input.provider_type.as_deref().unwrap_or("local")) == "gemini" {
        let path = url
            .path()
            .replace(":generateContent", ":streamGenerateContent");
        url.set_path(&path);
        if url.query().is_none() {
            url.set_query(Some("alt=sse"));
        }
    }
    Ok(url)
}

pub(crate) fn response_text(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = if let Some(index) = key.parse::<usize>().ok() {
                current.get(index)?
            } else {
                current.get(*key)?
            };
        }
        if let Some(text) = current.as_str() {
            return Some(text.to_string());
        }
        current.as_array().and_then(|parts| {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("");
            (!text.is_empty()).then_some(text)
        })
    })
}

pub(crate) fn history_turns(input: &CompleteMessageInput) -> Vec<(&str, &str)> {
    const MAX_MESSAGES: usize = 80;
    const MAX_CHARS: usize = 120_000;
    let mut selected = Vec::new();
    let mut characters = 0;
    for turn in input.history.iter().rev() {
        let role = match turn.role.as_str() {
            "user" | "assistant" => turn.role.as_str(),
            _ => continue,
        };
        let content = turn.content.trim();
        if content.is_empty() {
            continue;
        }
        let next = characters + content.chars().count();
        if !selected.is_empty() && next > MAX_CHARS {
            break;
        }
        selected.push((role, content));
        characters = next;
        if selected.len() >= MAX_MESSAGES {
            break;
        }
    }
    selected.reverse();
    selected
}

pub(crate) fn user_message(input: &CompleteMessageInput) -> String {
    let content = input.content.trim();
    let selected = if let Some(selection) = input.focus_selection.as_ref() {
        format!(
        "请围绕以下消息选区回答追问：\n\n> {}\n\n{}",
        selection.text.replace('\n', "\n> "),
        content,
        )
    } else {
        content.to_string()
    };
    if input.attachments.is_empty() {
        return selected;
    }
    let attachment_context = input.attachments.iter().map(|file| {
        if let Some(text) = file.text_content.as_deref() {
            format!("- {} [{}]:\n{}", file.name, file.mime_type, text)
        } else if file.mime_type.starts_with("image/") && file.data_url.is_some() {
            format!("- {} [{}]（图片已作为视觉内容附加）", file.name, file.mime_type)
        } else {
            format!("- {} [{}] ({} bytes; 可用附件句柄读取)", file.name, file.mime_type, file.size)
        }
    }).collect::<Vec<_>>().join("\n");
    format!("{selected}\n\n本轮附件（仅使用用户明确附加的文件）：\n{attachment_context}")
}

fn base64_payload(data_url: &str) -> Option<&str> {
    data_url.split_once(";base64,").map(|(_, payload)| payload)
}

fn image_attachments(input: &CompleteMessageInput) -> impl Iterator<Item = &AttachmentInput> {
    input.attachments.iter().filter(|file| {
        file.mime_type.starts_with("image/") && file.data_url.as_deref().and_then(base64_payload).is_some()
    })
}

fn openai_user_content(input: &CompleteMessageInput) -> Value {
    let mut content = vec![serde_json::json!({ "type": "text", "text": user_message(input) })];
    for file in image_attachments(input) {
        if let Some(url) = file.data_url.as_deref() {
            content.push(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": url },
            }));
        }
    }
    if content.len() == 1 { Value::String(user_message(input)) } else { Value::Array(content) }
}

fn anthropic_user_content(input: &CompleteMessageInput) -> Value {
    let mut content = vec![serde_json::json!({ "type": "text", "text": user_message(input) })];
    for file in image_attachments(input) {
        if let Some(data_url) = file.data_url.as_deref() {
            if let Some(data) = base64_payload(data_url) {
                content.push(serde_json::json!({
                    "type": "image",
                    "source": { "type": "base64", "media_type": file.mime_type, "data": data },
                }));
            }
        }
    }
    if content.len() == 1 { Value::String(user_message(input)) } else { Value::Array(content) }
}

fn gemini_user_parts(input: &CompleteMessageInput) -> Vec<Value> {
    let mut parts = vec![serde_json::json!({ "text": user_message(input) })];
    for file in image_attachments(input) {
        if let Some(data_url) = file.data_url.as_deref() {
            if let Some(data) = base64_payload(data_url) {
                parts.push(serde_json::json!({
                    "inline_data": { "mime_type": file.mime_type, "data": data },
                }));
            }
        }
    }
    parts
}

fn ollama_user_message(input: &CompleteMessageInput) -> Value {
    let mut message = serde_json::json!({ "role": "user", "content": user_message(input) });
    let images = image_attachments(input)
        .filter_map(|file| file.data_url.as_deref().and_then(base64_payload))
        .map(Value::from)
        .collect::<Vec<_>>();
    if !images.is_empty() { message["images"] = Value::Array(images); }
    message
}

pub(crate) fn prompt_with_web_context(prompt: &str, web_context: &str) -> String {
    if web_context.is_empty() { return prompt.to_string(); }
    if prompt.trim().is_empty() { return web_context.to_string(); }
    format!("{prompt}\n\n{web_context}")
}

pub(crate) fn remote_body(
    input: &CompleteMessageInput,
    provider_type: &str,
    model: &str,
    stream: bool,
    web_context: &str,
) -> Value {
    let prompt = prompt_with_web_context(input.instructions.as_deref().unwrap_or_default(), web_context);
    let temperature = input.temperature.unwrap_or(0.7).clamp(0.0, 2.0);
    let mut body = match provider_type {
        "anthropic" => serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "system": prompt,
            "messages": history_turns(input).into_iter()
                .map(|(role, content)| serde_json::json!({ "role": role, "content": content }))
                .chain(std::iter::once(serde_json::json!({ "role": "user", "content": anthropic_user_content(input) })))
                .collect::<Vec<_>>(),
            "temperature": temperature,
            "stream": stream,
        }),
        "gemini" => serde_json::json!({
            "systemInstruction": { "parts": [{ "text": prompt }] },
            "contents": history_turns(input).into_iter()
                .map(|(role, content)| serde_json::json!({ "role": if role == "assistant" { "model" } else { "user" }, "parts": [{ "text": content }] }))
                .chain(std::iter::once(serde_json::json!({ "role": "user", "parts": gemini_user_parts(input) })))
                .collect::<Vec<_>>(),
            "generationConfig": { "temperature": temperature },
        }),
        "ollama" => serde_json::json!({
            "model": model,
            "stream": stream,
            "messages": std::iter::once(serde_json::json!({ "role": "system", "content": prompt }))
                .chain(history_turns(input).into_iter().map(|(role, content)| serde_json::json!({ "role": role, "content": content })))
                .chain(std::iter::once(ollama_user_message(input)))
                .collect::<Vec<_>>(),
            "options": { "temperature": temperature },
        }),
        _ => serde_json::json!({
            "model": model,
            "stream": stream,
            "messages": std::iter::once(serde_json::json!({ "role": "system", "content": prompt }))
                .chain(history_turns(input).into_iter().map(|(role, content)| serde_json::json!({ "role": role, "content": content })))
                .chain(std::iter::once(serde_json::json!({ "role": "user", "content": openai_user_content(input) })))
                .collect::<Vec<_>>(),
            "temperature": temperature,
        }),
    };
    match input.reasoning_effort.as_deref() {
        Some("none") => {
            if provider_type == "ollama" { body["think"] = serde_json::json!(false); }
            if provider_type == "gemini" { body["generationConfig"]["thinkingConfig"] = serde_json::json!({ "thinkingBudget": 0 }); }
            if provider_type != "anthropic" && provider_type != "ollama" && provider_type != "gemini" { body["reasoning_effort"] = serde_json::json!("none"); }
        }
        Some(effort @ ("low" | "medium" | "high")) => {
            let budget = match effort { "low" => 2048, "medium" => 4096, _ => 8192 };
            match provider_type {
                "anthropic" => body["thinking"] = serde_json::json!({ "type": "enabled", "budget_tokens": budget }),
                "gemini" => body["generationConfig"]["thinkingConfig"] = serde_json::json!({ "thinkingBudget": budget }),
                "ollama" => body["think"] = serde_json::json!(true),
                _ => body["reasoning_effort"] = serde_json::json!(effort),
            }
        }
        _ => {}
    }
    body
}

pub(crate) fn with_provider_auth(
    mut request: reqwest::RequestBuilder,
    provider_type: &str,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    if provider_type == "gemini" {
        request = request.header("x-goog-api-key", api_key.unwrap_or_default());
    } else if provider_type == "anthropic" {
        request = request
            .header("x-api-key", api_key.unwrap_or_default())
            .header("anthropic-version", "2023-06-01");
    } else if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    request
}

pub(crate) async fn complete_remote(input: &CompleteMessageInput) -> Result<String, String> {
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
    let model = input
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "尚未选择模型".to_string())?;
    let api_key = provider_api_key(provider_id)?;
    if provider_requires_api_key_for(provider_type, input.base_url.as_deref().unwrap_or_default())
        && api_key.is_none()
    {
        return Err("尚未配置 API Key，请在设置中保存后重试".to_string());
    }
    let url = chat_url(input)?;
    let client = Client::builder()
        .timeout(timeout_duration(input.request_timeout_ms, 120_000))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))?;
    let web_context = web_search_context(input).await?;
    let body = remote_body(input, provider_type, model, false, &web_context);
    let request = with_provider_auth(
        client.post(url).json(&body),
        provider_type,
        api_key.as_deref(),
    );
    let response = request.send().await.map_err(|error| {
        format!(
            "调用 Provider 失败：{}",
            redact_sensitive_text(&error.to_string())
        )
    })?;
    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Provider 返回 HTTP {}：{}",
            status.as_u16(),
            truncate_error(&body_text)
        ));
    }
    let payload: Value = serde_json::from_str(&body_text)
        .map_err(|_| "Provider 返回了无法解析的 JSON".to_string())?;
    response_text(
        &payload,
        &[
            &["choices", "0", "message", "content"],
            &["content"],
            &["candidates", "0", "content", "parts"],
            &["message", "content"],
        ],
    )
    .ok_or_else(|| {
        format!(
            "Provider 响应中没有文本内容：{}",
            truncate_error(&body_text)
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ConversationTurnInput;

    #[test]
    fn extracts_text_from_openai_anthropic_and_gemini_responses() {
        let openai = serde_json::json!({"choices":[{"message":{"content":"hello"}}]});
        let anthropic = serde_json::json!({"content":[{"type":"text","text":"world"}]});
        let gemini = serde_json::json!({"candidates":[{"content":{"parts":[{"text":"!"}]}}]});
        assert_eq!(
            response_text(&openai, &[&["choices", "0", "message", "content"]]),
            Some("hello".to_string())
        );
        assert_eq!(
            response_text(&anthropic, &[&["content"]]),
            Some("world".to_string())
        );
        assert_eq!(
            response_text(&gemini, &[&["candidates", "0", "content", "parts"]]),
            Some("!".to_string())
        );
    }

    #[test]
    fn keeps_recent_valid_history_turns_with_a_bound() {
        let input = CompleteMessageInput {
            timeline_id: "timeline-1".to_string(),
            content: "current".to_string(),
            parent_node_id: None,
            relation: None,
            inquiry_root_id: None,
            focus_selection: None,
            model: Some("model".to_string()),
            provider_id: Some("provider".to_string()),
            provider_type: Some("openai-compatible".to_string()),
            base_url: Some("https://example.com/v1".to_string()),
            api_path: None,
            request_timeout_ms: None,
            instructions: None,
            temperature: None,
            reasoning_effort: None,
            web_search: false,
            history: vec![
                ConversationTurnInput {
                    role: "system".to_string(),
                    content: "ignored".to_string(),
                },
                ConversationTurnInput {
                    role: "user".to_string(),
                    content: "first".to_string(),
                },
                ConversationTurnInput {
                    role: "assistant".to_string(),
                    content: "second".to_string(),
                },
            ],
            attachments: Vec::new(),
        };
        assert_eq!(
            history_turns(&input),
            vec![("user", "first"), ("assistant", "second")]
        );
    }

    #[test]
    fn injects_web_search_results_into_provider_context() {
        let input = CompleteMessageInput {
            timeline_id: "timeline-1".to_string(), content: "最新进展".to_string(),
            parent_node_id: None, relation: None, inquiry_root_id: None, focus_selection: None,
            model: Some("model".to_string()), provider_id: Some("provider".to_string()),
            provider_type: Some("openai-compatible".to_string()), base_url: Some("https://example.com/v1".to_string()),
            api_path: None, request_timeout_ms: None, instructions: Some("请简洁回答".to_string()),
            temperature: None, reasoning_effort: None, web_search: true, history: Vec::new(),
            attachments: Vec::new(),
        };
        let body = remote_body(&input, "openai-compatible", "model", false,
            "实时联网搜索结果\n[1] Example\nURL: https://example.com\n摘要: result");
        let system = body["messages"][0]["content"].as_str().expect("system prompt");
        assert!(system.contains("实时联网搜索结果"));
        assert!(system.contains("https://example.com"));
        assert!(body.get("_5dmind").is_none());
    }

    #[test]
    fn sends_image_attachments_as_multimodal_parts() {
        let input = CompleteMessageInput {
            timeline_id: "timeline-1".to_string(),
            content: "这张图里有什么？".to_string(),
            parent_node_id: None,
            relation: None,
            inquiry_root_id: None,
            focus_selection: None,
            model: Some("vision-model".to_string()),
            provider_id: Some("provider".to_string()),
            provider_type: Some("openai-compatible".to_string()),
            base_url: Some("https://example.com/v1".to_string()),
            api_path: None,
            request_timeout_ms: None,
            instructions: None,
            temperature: None,
            reasoning_effort: None,
            web_search: false,
            history: Vec::new(),
            attachments: vec![AttachmentInput {
                _id: "image-1".to_string(),
                name: "photo.png".to_string(),
                mime_type: "image/png".to_string(),
                size: 4,
                text_content: None,
                data_url: Some("data:image/png;base64,aGVsbG8=".to_string()),
            }],
        };
        let openai = remote_body(&input, "openai-compatible", "vision-model", false, "");
        assert_eq!(openai["messages"][1]["content"][1]["type"], "image_url");
        assert_eq!(openai["messages"][1]["content"][1]["image_url"]["url"], "data:image/png;base64,aGVsbG8=");

        let gemini = remote_body(&input, "gemini", "vision-model", false, "");
        assert_eq!(gemini["contents"][0]["parts"][1]["inline_data"]["mime_type"], "image/png");
        assert_eq!(gemini["contents"][0]["parts"][1]["inline_data"]["data"], "aGVsbG8=");
    }

    #[test]
    fn sends_text_attachment_content_in_the_user_prompt() {
        let input = CompleteMessageInput {
            timeline_id: "timeline-1".to_string(),
            content: "请总结附件".to_string(),
            parent_node_id: None,
            relation: None,
            inquiry_root_id: None,
            focus_selection: None,
            model: Some("text-model".to_string()),
            provider_id: Some("provider".to_string()),
            provider_type: Some("openai-compatible".to_string()),
            base_url: Some("https://example.com/v1".to_string()),
            api_path: None,
            request_timeout_ms: None,
            instructions: None,
            temperature: None,
            reasoning_effort: None,
            web_search: false,
            history: Vec::new(),
            attachments: vec![AttachmentInput {
                _id: "docx-1".to_string(),
                name: "实验报告.docx".to_string(),
                mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string(),
                size: 1024,
                text_content: Some("这是从 DOCX 提取的正文".to_string()),
                data_url: None,
            }],
        };

        let body = remote_body(&input, "openai-compatible", "text-model", false, "");
        let prompt = body["messages"][1]["content"].as_str().expect("text prompt");
        assert!(prompt.contains("实验报告.docx"));
        assert!(prompt.contains("这是从 DOCX 提取的正文"));
    }
}
