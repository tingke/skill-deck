pub mod db;
pub mod scanner;
pub mod commands;
pub mod packages;
pub mod extensions;
pub mod projects;
pub mod project_packages;
pub mod agents;
pub mod settings;
pub mod skill_connections;

use db::{DbState, open};
use tauri::Manager;

 #[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState(std::sync::Mutex::new(open())))
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

            let app_menu = Submenu::with_items(app, "SkillDeck", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;

            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])?;

            let reload = MenuItem::with_id(app, "reload", "Reload Page", true, Some("CmdOrCtrl+R"))?;
            let force_reload = MenuItem::with_id(app, "force_reload", "Force Reload", true, Some("CmdOrCtrl+Shift+R"))?;
            let devtools = MenuItem::with_id(app, "toggle_devtools", "Toggle Developer Tools", true, Some("CmdOrCtrl+Alt+I"))?;
            let view_menu = Submenu::with_items(app, "View", true, &[
                &reload,
                &force_reload,
                &PredefinedMenuItem::separator(app)?,
                &devtools,
                &PredefinedMenuItem::fullscreen(app, None)?,
            ])?;

            let window_menu = Submenu::with_items(app, "Window", true, &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ])?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("location.reload()");
                    }
                }
                "force_reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(
                            "(()=>{const u=new URL(location.href);u.searchParams.set('_t',Date.now());location.href=u.toString()})()"
                        );
                    }
                }
                "toggle_devtools" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_devtools_open() {
                            window.close_devtools();
                        } else {
                            window.open_devtools();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::reveal_in_finder,
            commands::get_home_directory,
            commands::get_runtimes,
            commands::verify_connections,
            commands::get_skill_connections,
            commands::adopt_real_entry,
             commands::scan_all,
             commands::get_skills,
             commands::connect_skill,
             commands::disconnect_skill,
             commands::batch_connect,
            commands::read_skill_file,
            commands::write_skill_file,
            commands::get_recent_activity,
            commands::delete_skill,
            commands::update_skill_tags,
            commands::toggle_skill_enabled,
            commands::list_skill_files,
            commands::read_skill_file_path,
            // library sources (库源管理)
            commands::get_library_sources,
            commands::save_library_source,
            commands::delete_library_source,
            commands::get_prompts,
            commands::save_prompt,
            commands::delete_prompt,
           commands::get_rules,
           commands::save_rule,
           commands::delete_rule,
           commands::apply_rule,
           commands::scan_rules,
           // 预设 (packages)
            packages::get_packages,
            packages::get_package,
            packages::save_pkg,
            packages::delete_pkg,
            packages::apply_pkg,
            packages::export_pkg,
            packages::import_pkg,
            packages::pick_folder,
            packages::pick_save_folder,
            packages::apply_pkg_to_project,
            project_packages::create_pkg_from_project,
            // projects (项目管理)
            projects::get_projects,
            projects::save_project,
            projects::delete_project,
            projects::pick_project_folder,
            // extensions (MCP / Hook / Plugin)
            extensions::scan_ext,
            extensions::get_ext,
            extensions::toggle_ext,
            extensions::save_mcp_cmd,
            extensions::save_hook_cmd,
            extensions::toggle_plugin_cmd,
           extensions::delete_ext,
           extensions::ext_config_path,
           // agents (运行环境注册表)
           agents::get_agents,
           agents::save_agent,
           agents::toggle_agent,
           agents::delete_agent,
           agents::agent_mcp_path,
           // settings (开机启动 / 备份恢复 / 关于 / 更新检查)
           settings::get_app_info,
           settings::is_autostart_enabled,
           settings::set_autostart,
           settings::backup_database,
           settings::restore_database,
           settings::get_setting,
           settings::set_setting,
           settings::pick_backup_folder,
           settings::pick_backup_file,
           settings::open_data_dir,
           settings::check_update,
           settings::toggle_devtools,
      ])
       .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
