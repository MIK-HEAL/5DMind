mod commands;
mod credentials;
mod db;
mod providers;
mod search;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            app.manage(db::AppState::open(data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::load_workspace,
            db::save_workspace,
            db::reset_workspace,
            commands::complete_message,
            credentials::list_provider_credentials,
            credentials::set_provider_credential,
            credentials::delete_provider_credential,
            providers::directory::test_provider_connection,
            providers::directory::list_provider_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running 5DMind");
}
