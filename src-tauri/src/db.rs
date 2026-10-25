use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS workspace_snapshots (\
  snapshot_key TEXT PRIMARY KEY NOT NULL,\
  version INTEGER NOT NULL,\
  payload TEXT NOT NULL,\
  updated_at TEXT NOT NULL\
);\
CREATE TABLE IF NOT EXISTS provider_credentials (\
  provider_id TEXT PRIMARY KEY NOT NULL,\
  api_key TEXT NOT NULL\
)";

pub(crate) struct AppState {
    pub(crate) database: Arc<Mutex<Connection>>,
}

impl AppState {
    pub(crate) fn open(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
        let database =
            Connection::open(data_dir.join("5dmind.sqlite3")).map_err(|error| error.to_string())?;
        database
            .execute_batch(SCHEMA)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            database: Arc::new(Mutex::new(database)),
        })
    }

    #[cfg(test)]
    pub(crate) fn in_memory() -> Result<Self, String> {
        let database = Connection::open_in_memory().map_err(|error| error.to_string())?;
        database
            .execute_batch(SCHEMA)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            database: Arc::new(Mutex::new(database)),
        })
    }
}

#[tauri::command]
pub(crate) fn load_workspace(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM workspace_snapshots WHERE snapshot_key = 'active'")
        .map_err(|error| error.to_string())?;
    let payload = statement
        .query_row([], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|error| error.to_string())?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

pub(crate) fn load_workspace_value(state: &AppState) -> Result<Option<Value>, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM workspace_snapshots WHERE snapshot_key = 'active'")
        .map_err(|error| error.to_string())?;
    let payload = statement
        .query_row([], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|error| error.to_string())?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub(crate) fn save_workspace(snapshot: Value, state: State<'_, AppState>) -> Result<(), String> {
    let version = snapshot
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "工作区缺少有效版本号".to_string())?;
    let payload = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
    let database = state
        .database
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    database
        .execute(
            "INSERT INTO workspace_snapshots(snapshot_key, version, payload, updated_at)\
             VALUES ('active', ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\
             ON CONFLICT(snapshot_key) DO UPDATE SET version = excluded.version,\
             payload = excluded.payload, updated_at = excluded.updated_at",
            params![version, payload],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn save_workspace_value(snapshot: &Value, state: &AppState) -> Result<(), String> {
    let version = snapshot
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "工作区缺少有效版本号".to_string())?;
    let payload = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    let database = state
        .database
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    database
        .execute(
            "INSERT INTO workspace_snapshots(snapshot_key, version, payload, updated_at)\
             VALUES ('active', ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\
             ON CONFLICT(snapshot_key) DO UPDATE SET version = excluded.version,\
             payload = excluded.payload, updated_at = excluded.updated_at",
            params![version, payload],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn reset_workspace(state: State<'_, AppState>) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    database
        .execute(
            "DELETE FROM workspace_snapshots WHERE snapshot_key = 'active'",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_reads_a_workspace_snapshot() {
        let state = AppState::in_memory().expect("in-memory database");
        let snapshot = serde_json::json!({
            "version": 1,
            "currentConversationId": "conversation-1",
            "currentTimelineId": "timeline-1",
            "conversations": [],
            "timelines": [],
            "nodes": [{
                "id": "inquiry-1",
                "timelineId": "timeline-1",
                "parentNodeId": "node-source",
                "relation": "focused-inquiry",
                "focusSelection": {
                    "sourceNodeId": "node-source",
                    "text": "桌面优先",
                    "start": 0,
                    "end": 4,
                    "contentHash": "a1b2c3d4"
                },
                "kind": "user",
                "content": "为什么？",
                "summary": "为什么？",
                "status": "complete",
                "createdAt": "2026-09-29T00:00:00.000Z",
                "metadata": {"tags": ["选区追问"]}
            }],
            "threats": [],
            "references": []
        });
        {
            let database = state.database.lock().expect("database lock");
            let payload = serde_json::to_string(&snapshot).expect("serialize");
            database
                .execute(
                    "INSERT INTO workspace_snapshots(snapshot_key, version, payload, updated_at)\
                 VALUES ('active', 1, ?1, 'now')",
                    params![payload],
                )
                .expect("insert snapshot");
        }
        let database = state.database.lock().expect("database lock");
        let payload: String = database
            .query_row(
                "SELECT payload FROM workspace_snapshots WHERE snapshot_key = 'active'",
                [],
                |row| row.get(0),
            )
            .expect("read snapshot");
        assert_eq!(
            serde_json::from_str::<Value>(&payload).expect("parse"),
            snapshot
        );
    }

    #[test]
    fn creates_the_private_provider_credential_store() {
        let state = AppState::in_memory().expect("in-memory database");
        let database = state.database.lock().expect("database lock");
        database
            .execute(
                "INSERT INTO provider_credentials(provider_id, api_key) VALUES ('provider-test', 'secret')",
                [],
            )
            .expect("insert provider credential");
        let stored: String = database
            .query_row(
                "SELECT api_key FROM provider_credentials WHERE provider_id = 'provider-test'",
                [],
                |row| row.get(0),
            )
            .expect("read provider credential");
        assert_eq!(stored, "secret");
    }
}
