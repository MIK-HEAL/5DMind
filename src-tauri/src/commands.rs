use crate::providers::chat::complete_remote;
use crate::providers::stream::{complete_remote_stream, emit_stream_event};
use base64::Engine;
use serde::Serialize;
use std::path::Path;
use crate::providers::{
    CompleteMessageInput, CompleteMessageResponse, ProviderStreamEvent, provider_kind,
    validated_relation,
};

const MAX_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT: usize = 120_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAttachment {
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) size: u64,
    pub(crate) text_content: Option<String>,
    pub(crate) data_url: Option<String>,
}

#[tauri::command]
pub(crate) fn read_local_attachment(path: String) -> Result<LocalAttachment, String> {
    let source = Path::new(&path);
    let metadata = std::fs::metadata(source).map_err(|error| format!("无法读取文件：{error}"))?;
    if !metadata.is_file() {
        return Err("只能附加普通文件".to_string());
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err("单文件不能超过 8 MB".to_string());
    }
    let name = source.file_name().and_then(|value| value.to_str()).unwrap_or("附件").to_string();
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(extension.as_str(), "exe" | "dll" | "dmg" | "app" | "sh" | "bat" | "cmd" | "ps1" | "com") {
        return Err("不支持附加可执行文件".to_string());
    }
    let bytes = std::fs::read(source).map_err(|error| format!("文件读取失败：{error}"))?;
    let mime_type = match extension.as_str() {
        "md" | "mdx" => "text/markdown",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "json" | "jsonl" => "application/json",
        "html" | "htm" => "text/html",
        "xml" => "application/xml",
        "yaml" | "yml" => "text/yaml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }.to_string();
    let is_text = mime_type.starts_with("text/") || matches!(extension.as_str(), "json" | "jsonl" | "xml" | "yaml" | "yml");
    let text_content = if is_text {
        Some(String::from_utf8_lossy(&bytes).chars().take(MAX_ATTACHMENT_TEXT).collect())
    } else {
        None
    };
    let data_url = if text_content.is_none() {
        Some(format!("data:{};base64,{}", mime_type, base64::engine::general_purpose::STANDARD.encode(bytes)))
    } else {
        None
    };
    Ok(LocalAttachment { name, mime_type, size: metadata.len(), text_content, data_url })
}

pub(crate) async fn complete_message_inner(
    input: CompleteMessageInput,
    on_event: Option<tauri::ipc::Channel<ProviderStreamEvent>>,
) -> Result<CompleteMessageResponse, String> {
    let content = input.content.trim();
    if content.is_empty() {
        return Err("消息不能为空".to_string());
    }
    let relation = validated_relation(input.relation.as_deref(), input.focus_selection.as_ref())?;
    let subject_content = if let Some(selection) = input.focus_selection.as_ref() {
        format!("选区“{}” · {}", selection.text, content)
    } else {
        content.to_string()
    };
    let attachment_suffix = if input.attachments.is_empty() {
        String::new()
    } else {
        format!(" · 附件 {} 个", input.attachments.len())
    };
    let subject = if subject_content.chars().count() > 36 {
        let shortened: String = subject_content.chars().take(36).collect();
        format!("{shortened}…{attachment_suffix}")
    } else {
        format!("{subject_content}{attachment_suffix}")
    };
    let message_id = format!("node-{}", uuid::Uuid::new_v4());
    let model = input
        .model
        .clone()
        .unwrap_or_else(|| "5D Local Gateway".to_string());
    if let Some(channel) = on_event.as_ref() {
        emit_stream_event(
            channel,
            ProviderStreamEvent {
                event: "started".to_string(),
                message_id: message_id.clone(),
                model: model.clone(),
                relation: relation.clone(),
                inquiry_root_id: input.inquiry_root_id.clone(),
                focus_selection: input.focus_selection.clone(),
                delta: None,
                error: None,
            },
        )?;
    }
    let is_local = provider_kind(input.provider_type.as_deref().unwrap_or("local")) == "local";
    let reply_result = if is_local && input.web_search {
        Err("当前本地 ModelGateway 不支持联网搜索，请切换到已配置 URL 的远程 Provider（或 Ollama）后重试".to_string())
    } else if is_local {
        Ok(format!(
            "我会把“{subject}”记录在当前时间线，并先从三个角度处理：\n\n1. 明确这条消息改变了什么假设；\n2. 检查它与现有分支、引用和风险的关系；\n3. 给出一个可以继续分支验证的下一步。\n\n当前回复由桌面本地 ModelGateway 生成，工作区数据不会离开本机。"
        ))
    } else if let Some(channel) = on_event.as_ref() {
        complete_remote_stream(&input, channel, &message_id, &model).await
    } else {
        complete_remote(&input).await
    };
    let reply = match reply_result {
        Ok(reply) => reply,
        Err(error) => {
            if let Some(channel) = on_event.as_ref() {
                let _ = emit_stream_event(
                    channel,
                    ProviderStreamEvent {
                        event: "failed".to_string(),
                        message_id: message_id.clone(),
                        model: model.clone(),
                        relation: relation.clone(),
                        inquiry_root_id: input.inquiry_root_id.clone(),
                        focus_selection: input.focus_selection.clone(),
                        delta: None,
                        error: Some(error.clone()),
                    },
                );
            }
            return Err(error);
        }
    };
    if let Some(channel) = on_event.as_ref() {
        if is_local {
            let mut delta = String::new();
            for character in reply.chars() {
                delta.push(character);
                if delta.chars().count() >= 8 {
                    emit_stream_event(
                        channel,
                        ProviderStreamEvent {
                            event: "delta".to_string(),
                            message_id: message_id.clone(),
                            model: model.clone(),
                            relation: None,
                            inquiry_root_id: None,
                            focus_selection: None,
                            delta: Some(std::mem::take(&mut delta)),
                            error: None,
                        },
                    )?;
                }
            }
            if !delta.is_empty() {
                emit_stream_event(
                    channel,
                    ProviderStreamEvent {
                        event: "delta".to_string(),
                        message_id: message_id.clone(),
                        model: model.clone(),
                        relation: None,
                        inquiry_root_id: None,
                        focus_selection: None,
                        delta: Some(delta),
                        error: None,
                    },
                )?;
            }
        }
        emit_stream_event(
            channel,
            ProviderStreamEvent {
                event: "completed".to_string(),
                message_id: message_id.clone(),
                model: model.clone(),
                relation: relation.clone(),
                inquiry_root_id: input.inquiry_root_id.clone(),
                focus_selection: input.focus_selection.clone(),
                delta: None,
                error: None,
            },
        )?;
    }
    Ok(CompleteMessageResponse {
        message_id,
        timeline_id: input.timeline_id,
        parent_node_id: input.parent_node_id,
        relation,
        inquiry_root_id: input.inquiry_root_id,
        focus_selection: input.focus_selection,
        content: reply,
        model,
    })
}

#[tauri::command]
pub(crate) async fn complete_message(
    input: CompleteMessageInput,
    on_event: tauri::ipc::Channel<ProviderStreamEvent>,
) -> Result<CompleteMessageResponse, String> {
    complete_message_inner(input, Some(on_event)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::FocusSelectionInput;

    #[test]
    fn completes_a_local_message_without_network_access() {
        let response = tauri::async_runtime::block_on(complete_message_inner(
            CompleteMessageInput {
                timeline_id: "timeline-1".to_string(),
                content: "验证桌面对话链路".to_string(),
                parent_node_id: Some("node-1".to_string()),
                relation: None,
                inquiry_root_id: None,
                focus_selection: None,
                model: None,
                provider_id: Some("provider-local".to_string()),
                provider_type: Some("local".to_string()),
                base_url: None,
                api_path: None,
                request_timeout_ms: None,
                instructions: None,
                temperature: None,
                reasoning_effort: None,
                web_search: false,
                history: Vec::new(),
                attachments: Vec::new(),
            },
            None,
        ))
        .expect("local completion");
        assert_eq!(response.timeline_id, "timeline-1");
        assert_eq!(response.parent_node_id.as_deref(), Some("node-1"));
        assert!(response.content.contains("验证桌面对话链路"));
        assert_eq!(response.model, "5D Local Gateway");
    }

    #[test]
    fn reports_that_the_local_gateway_cannot_search_the_web() {
        let result = tauri::async_runtime::block_on(complete_message_inner(
            CompleteMessageInput {
                timeline_id: "timeline-1".to_string(), content: "搜索今天的新闻".to_string(),
                parent_node_id: None, relation: None, inquiry_root_id: None, focus_selection: None,
                model: Some("5D Local Gateway".to_string()), provider_id: Some("provider-local".to_string()),
                provider_type: Some("local".to_string()), base_url: None, api_path: None,
                request_timeout_ms: None, instructions: None, temperature: None, reasoning_effort: None,
                web_search: true, history: Vec::new(),
                attachments: Vec::new(),
            }, None,
        ));
        assert!(result.expect_err("local web search should be rejected").contains("不支持联网搜索"));
    }

    #[test]
    fn preserves_focused_inquiry_metadata_in_the_desktop_response() {
        let selection = FocusSelectionInput {
            source_node_id: "node-source".to_string(),
            text: "桌面优先".to_string(),
            start: Some(0),
            end: Some(4),
            content_hash: "a1b2c3d4".to_string(),
        };
        let response = tauri::async_runtime::block_on(complete_message_inner(
            CompleteMessageInput {
                timeline_id: "timeline-1".to_string(),
                content: "请解释这句话".to_string(),
                parent_node_id: Some("node-source".to_string()),
                relation: Some("focused-inquiry".to_string()),
                inquiry_root_id: Some("inquiry-root".to_string()),
                focus_selection: Some(selection.clone()),
                model: None,
                provider_id: Some("provider-local".to_string()),
                provider_type: Some("local".to_string()),
                base_url: None,
                api_path: None,
                request_timeout_ms: None,
                instructions: None,
                temperature: None,
                reasoning_effort: None,
                web_search: false,
                history: Vec::new(),
                attachments: Vec::new(),
            },
            None,
        ))
        .expect("focused inquiry completion");

        assert_eq!(response.relation.as_deref(), Some("focused-inquiry"));
        assert_eq!(
            response.focus_selection.as_ref().map(|value| &value.text),
            Some(&selection.text)
        );
        assert!(response.content.contains("桌面优先"));
    }
}
