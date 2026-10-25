mod commands;
mod credentials;
mod db;
mod providers;
mod search;
mod timeline_tools;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::read_local_attachment,
            credentials::list_provider_credentials,
            credentials::set_provider_credential,
            credentials::delete_provider_credential,
            providers::directory::test_provider_connection,
            providers::directory::list_provider_models,
            timeline_tools::execute_timeline_tool
        ])
        .run(tauri::generate_context!())
        .expect("error while running 5DMind");
}
