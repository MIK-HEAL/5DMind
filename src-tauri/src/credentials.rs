#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::sync::{Arc, Mutex, OnceLock};

use crate::db::AppState;

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
const KEYRING_SERVICE: &str = "app.5dmind.provider";
static MOBILE_DATABASE: OnceLock<Arc<Mutex<rusqlite::Connection>>> = OnceLock::new();

pub(crate) fn initialize(state: &AppState) {
    let _ = MOBILE_DATABASE.set(state.database.clone());
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCredentialInput {
    pub(crate) provider_id: String,
    pub(crate) api_key: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCredentialStatus {
    pub(crate) provider_id: String,
    pub(crate) configured: bool,
}

pub(crate) fn validate_provider_id(provider_id: &str) -> Result<(), String> {
    let valid = !provider_id.is_empty()
        && provider_id.len() <= 128
        && provider_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err("Provider ID 只能包含字母、数字、连字符和下划线".to_string())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
fn provider_entry(provider_id: &str) -> Result<keyring::Entry, String> {
    validate_provider_id(provider_id)?;
    keyring::Entry::new(KEYRING_SERVICE, provider_id)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))
}

pub(crate) fn normalize_api_key(value: &str) -> String {
    let mut normalized = value.trim().to_string();
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if (bytes[0] == b'"' && bytes[normalized.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[normalized.len() - 1] == b'\'')
        {
            normalized = normalized[1..normalized.len() - 1].trim().to_string();
        }
    }
    if normalized
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("bearer "))
    {
        normalized[7..].trim().to_string()
    } else {
        normalized
    }
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
pub(crate) fn provider_api_key(provider_id: &str) -> Result<Option<String>, String> {
    let entry = provider_entry(provider_id)?;
    match entry.get_password() {
        Ok(value) => {
            let normalized = normalize_api_key(&value);
            if normalized.is_empty() {
                Ok(None)
            } else {
                Ok(Some(normalized))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取系统凭据失败：{error}")),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
fn mobile_database() -> Result<&'static Arc<Mutex<rusqlite::Connection>>, String> {
    MOBILE_DATABASE
        .get()
        .ok_or_else(|| "移动端存储尚未初始化".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
pub(crate) fn provider_api_key(provider_id: &str) -> Result<Option<String>, String> {
    validate_provider_id(provider_id)?;
    let database = mobile_database()?
        .lock()
        .map_err(|_| "数据库锁已损坏".to_string())?;
    database
        .query_row(
            "SELECT api_key FROM provider_credentials WHERE provider_id = ?1",
            [provider_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取移动端凭据失败：{error}"))
}

#[tauri::command]
pub(crate) fn list_provider_credentials(
    provider_ids: Vec<String>,
) -> Result<Vec<ProviderCredentialStatus>, String> {
    provider_ids
        .into_iter()
        .map(|provider_id| {
            let configured = provider_api_key(&provider_id)?.is_some();
            Ok(ProviderCredentialStatus {
                provider_id,
                configured,
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn set_provider_credential(input: ProviderCredentialInput) -> Result<(), String> {
    let value = normalize_api_key(&input.api_key);
    if value.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
    {
        let entry = provider_entry(&input.provider_id)?;
        entry
            .set_password(&value)
            .map_err(|error| format!("保存 API Key 到系统凭据库失败：{error}"))?;
        return match entry.get_password() {
            Ok(stored) if normalize_api_key(&stored) == value => Ok(()),
            Ok(_) => Err("系统凭据库写入后校验不一致，请重试".to_string()),
            Err(error) => Err(format!("API Key 已写入但无法读回校验：{error}")),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
    {
        validate_provider_id(&input.provider_id)?;
        let database = mobile_database()?
            .lock()
            .map_err(|_| "数据库锁已损坏".to_string())?;
        database
            .execute(
                "INSERT INTO provider_credentials(provider_id, api_key) VALUES (?1, ?2)\
                 ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key",
                (&input.provider_id, &value),
            )
            .map_err(|error| format!("保存移动端 API Key 失败：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn delete_provider_credential(provider_id: String) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
    {
        match provider_entry(&provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除系统凭据失败：{error}")),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
    {
        validate_provider_id(&provider_id)?;
        let database = mobile_database()?
            .lock()
            .map_err(|_| "数据库锁已损坏".to_string())?;
        database
            .execute(
                "DELETE FROM provider_credentials WHERE provider_id = ?1",
                [provider_id],
            )
            .map_err(|error| format!("删除移动端 API Key 失败：{error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_common_api_key_wrappers() {
        assert_eq!(normalize_api_key(" sk-test-value "), "sk-test-value");
        assert_eq!(normalize_api_key("Bearer sk-test-value"), "sk-test-value");
        assert_eq!(
            normalize_api_key("\"Bearer sk-test-value\""),
            "sk-test-value"
        );
    }
}
