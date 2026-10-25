use crate::db::{load_workspace_value, save_workspace_value, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelineToolInput {
    pub(crate) operation: String,
    pub(crate) permission_mode: String,
    #[serde(default)]
    pub(crate) confirmed: bool,
    pub(crate) timeline_id: String,
    pub(crate) node_id: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) severity: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) target_timeline_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelineToolResult {
    pub(crate) applied: bool,
    pub(crate) requires_confirmation: bool,
    pub(crate) operation: String,
    pub(crate) message: String,
    pub(crate) id: Option<String>,
}

fn id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}

fn text(value: Option<&String>, label: &str) -> Result<String, String> {
    let value = value.map(String::as_str).unwrap_or("").trim();
    if value.is_empty() { return Err(format!("{label}不能为空")); }
    Ok(value.to_string())
}

fn operation_label(operation: &str) -> &'static str {
    match operation {
        "create-branch" => "创建时间线分支",
        "create-node" => "创建时间线节点",
        "create-threat" => "创建风险标记",
        "create-reference" => "创建跨线引用",
        _ => "执行时间线操作",
    }
}

fn authorize(permission_mode: &str, confirmed: bool) -> Result<bool, String> {
    if !matches!(permission_mode, "read-only" | "ask" | "auto") {
        return Err("不支持的 Agent 权限模式".to_string());
    }
    if permission_mode == "read-only" {
        return Err("当前 Agent 为只读模式，不能修改时间线".to_string());
    }
    Ok(permission_mode == "ask" && !confirmed)
}

#[tauri::command]
pub(crate) fn execute_timeline_tool(
    input: TimelineToolInput,
    state: State<'_, AppState>,
) -> Result<TimelineToolResult, String> {
    let needs_confirmation = authorize(&input.permission_mode, input.confirmed)?;
    if !matches!(input.operation.as_str(), "create-branch" | "create-node" | "create-threat" | "create-reference") {
        return Err(format!("不支持的时间线工具操作：{}", input.operation));
    }
    if needs_confirmation {
        return Ok(TimelineToolResult {
            applied: false,
            requires_confirmation: true,
            operation: input.operation.clone(),
            message: format!("Agent 请求{}，确认后才会写入时间线", operation_label(&input.operation)),
            id: None,
        });
    }

    let mut snapshot = load_workspace_value(&state)?.ok_or_else(|| "工作区尚未初始化".to_string())?;
    let timeline_id = input.timeline_id.trim();
    if timeline_id.is_empty() { return Err("timelineId不能为空".to_string()); }
    let timelines = snapshot.get_mut("timelines").and_then(Value::as_array_mut).ok_or_else(|| "工作区缺少时间线数据".to_string())?;
    let timeline_index = timelines.iter().position(|item| item.get("id").and_then(Value::as_str) == Some(timeline_id)).ok_or_else(|| "目标时间线不存在".to_string())?;
    let now = chrono_like_now();
    let created_id = match input.operation.as_str() {
        "create-branch" => {
            let source = timelines[timeline_index].clone();
            let branch_id = id("timeline");
            let name = input.name.as_deref().unwrap_or("新的分支").trim();
            let branch = json!({"id": branch_id, "conversationId": source["conversationId"], "name": if name.is_empty() { "新的分支" } else { name }, "parentTimelineId": timeline_id, "forkedFromNodeId": input.node_id, "contextMode": "all", "status": "active", "color": source["color"], "createdAt": now, "updatedAt": now});
            timelines.push(branch);
            snapshot["currentTimelineId"] = Value::String(branch_id.clone());
            Some(branch_id)
        }
        "create-node" => {
            let content = text(input.content.as_ref(), "节点内容")?;
            let node_id = id("node");
            let node = json!({"id": node_id, "timelineId": timeline_id, "parentNodeId": input.node_id, "kind": "system", "content": content, "summary": content.chars().take(44).collect::<String>(), "status": "complete", "createdAt": now, "metadata": {"author": "Agent"}});
            snapshot.get_mut("nodes").and_then(Value::as_array_mut).ok_or_else(|| "工作区缺少节点数据".to_string())?.push(node);
            Some(node_id)
        }
        "create-threat" => {
            let title = text(input.title.as_ref(), "风险标题")?;
            let severity = input.severity.as_deref().unwrap_or("medium");
            if !matches!(severity, "low" | "medium" | "high") { return Err("风险级别无效".to_string()); }
            let threat_id = id("threat");
            let threat = json!({"id": threat_id, "conversationId": snapshot["currentConversationId"], "nodeId": input.node_id, "title": title, "detail": input.detail.as_deref().unwrap_or(""), "severity": severity, "status": "open", "createdAt": now});
            snapshot.get_mut("threats").and_then(Value::as_array_mut).ok_or_else(|| "工作区缺少风险数据".to_string())?.push(threat);
            Some(threat_id)
        }
        "create-reference" => {
            let source_node_id = text(input.node_id.as_ref(), "来源节点")?;
            let target_timeline_id = text(input.target_timeline_id.as_ref(), "目标时间线")?;
            if !timelines.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(target_timeline_id.as_str())) { return Err("目标时间线不存在".to_string()); }
            let reference_id = id("reference");
            let link = json!({"id": reference_id, "sourceNodeId": source_node_id, "targetNodeId": target_timeline_id, "label": input.title.as_deref().unwrap_or("Agent 引用"), "createdAt": now});
            snapshot.get_mut("references").and_then(Value::as_array_mut).ok_or_else(|| "工作区缺少引用数据".to_string())?.push(link);
            Some(reference_id)
        }
        _ => unreachable!(),
    };
    save_workspace_value(&snapshot, &state)?;
    Ok(TimelineToolResult { applied: true, requires_confirmation: false, operation: input.operation, message: "时间线工具已执行".to_string(), id: created_id })
}

fn chrono_like_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permission_modes_gate_mutations_before_loading_workspace() {
        let result = authorize("read-only", false).unwrap_err();
        assert!(result.contains("只读"));
        assert!(authorize("ask", false).unwrap());
        assert!(!authorize("ask", true).unwrap());
    }
}
