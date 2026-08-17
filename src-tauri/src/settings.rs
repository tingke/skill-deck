use crate::db::{DbState, data_dir, db_path, now_iso};
use rusqlite::params;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State};

/// GitHub "owner/repo" for release checks. Leave empty to disable online update check.
const GITHUB_REPO: &str = "tingke/skill-deck";

// ============ App metadata ============

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub data_dir: String,
    pub db_path: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    let data_dir = data_dir();
    AppInfo {
        name: "SkillDeck".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        identifier: "com.tingke.skilldeck".into(),
        db_path: db_path().to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
    }
}

// ============ Launch at login (macOS LaunchAgent) ============

fn launch_agent_plist_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/LaunchAgents/com.tingke.skilldeck.plist")
}

fn legacy_launch_agent_plist_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/LaunchAgents/com.tingke.ai-hub.plist")
}

#[tauri::command]
pub fn is_autostart_enabled() -> bool {
    launch_agent_plist_path().exists() || legacy_launch_agent_plist_path().exists()
}

/// Toggle launch-at-login by creating/removing a macOS LaunchAgent plist.
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let plist = launch_agent_plist_path();
    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("无法获取可执行文件路径: {}", e))?;
        let exe_str = exe.to_string_lossy();
        let content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tingke.skilldeck</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>LaunchOnlyOnce</key>
    <true/>
</dict>
</plist>"#,
            exe = exe_str
        );
        if let Some(parent) = plist.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
        }
        fs::write(&plist, content).map_err(|e| format!("写入失败: {}", e))?;
        let legacy_plist = legacy_launch_agent_plist_path();
        if legacy_plist.exists() {
            fs::remove_file(&legacy_plist).map_err(|e| format!("移除旧启动项失败: {}", e))?;
        }
    } else if plist.exists() {
        fs::remove_file(&plist).map_err(|e| format!("移除失败: {}", e))?;
    }
    if !enabled {
        let legacy_plist = legacy_launch_agent_plist_path();
        if legacy_plist.exists() {
            fs::remove_file(&legacy_plist).map_err(|e| format!("移除旧启动项失败: {}", e))?;
        }
    }
    Ok(enabled)
}

// ============ Backup / Restore ============

/// Backup the SQLite database to a user-chosen directory with a timestamped name.
#[tauri::command]
pub fn backup_database(db: State<DbState>, dest_dir: String) -> Result<String, String> {
    let _conn = db.0.lock().map_err(|e| e.to_string())?; // hold lock so no write races the copy
    let src = db_path();
    if !src.exists() {
        return Err("数据库文件不存在".into());
    }
    let dest = PathBuf::from(&dest_dir).join(format!("skilldeck-backup-{}.db", now_iso()));
    fs::copy(&src, &dest).map_err(|e| format!("备份失败: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Restore the database from a backup .db file by ATTACH-ing it and copying
/// every table's rows into the live connection. No restart needed.
#[tauri::command]
pub fn restore_database(db: State<DbState>, src_path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute("ATTACH DATABASE ?1 AS src", params![&src_path])
        .map_err(|e| format!("无法打开备份文件: {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys = OFF;").ok();

    const TABLES: &[&str] = &[
        "skills", "connections", "presets", "prompts", "rules",
        "activity_log", "settings", "extensions", "packages",
        "package_skills", "package_mcps", "package_configs",
        "agents", "projects", "library_sources",
    ];
    for table in TABLES {
        // 兼容旧备份：备份文件中不存在的表跳过，避免整体恢复失败
        let exists_in_src: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM src.sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .unwrap_or(false);
        if !exists_in_src {
            continue;
        }
        conn.execute(&format!("DELETE FROM main.{}", table), [])
            .map_err(|e| format!("清理 {} 失败: {}", table, e))?;
        conn.execute(&format!("INSERT INTO main.{} SELECT * FROM src.{}", table, table), [])
            .map_err(|e| format!("恢复 {} 失败: {}", table, e))?;
    }

    conn.execute_batch("PRAGMA foreign_keys = ON;").ok();
    conn.execute("DETACH DATABASE src", [])
        .map_err(|e| format!("分离备份失败: {}", e))?;
    Ok(())
}

// ============ Generic settings (key/value) ============

#[tauri::command]
pub fn get_setting(db: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok();
    Ok(val)
}

#[tauri::command]
pub fn set_setting(db: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ File pickers (reuse rfd pattern) ============

#[tauri::command]
pub fn pick_backup_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().set_title("选择备份保存位置").pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn pick_backup_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .set_title("选择要恢复的备份文件")
        .add_filter("数据库备份", &["db"])
        .pick_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).ok();
    std::process::Command::new("open")
        .arg(&dir)
        .status()
        .map_err(|e| format!("打开失败: {}", e))?;
    Ok(())
}

// ============ Devtools ============

#[tauri::command]
pub fn toggle_devtools(app: tauri::AppHandle, open: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if open {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
    Ok(())
}

// ============ Update check ============

#[derive(Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current: String,
    pub latest: String,
    pub url: String,
    pub not_configured: bool,
}

/// Check GitHub releases for a newer version via curl (no extra Rust deps).
/// When GITHUB_REPO is empty, returns not_configured = true.
#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();

    if GITHUB_REPO.is_empty() {
        return Ok(UpdateInfo {
            has_update: false,
            current,
            latest: String::new(),
            url: String::new(),
            not_configured: true,
        });
    }

    let repo = GITHUB_REPO.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
        std::process::Command::new("curl")
            .arg("-s")
            .arg("-H")
            .arg("Accept: application/vnd.github+json")
            .arg("--max-time")
            .arg("12")
            .arg(&url)
            .output()
    })
    .await
    .map_err(|e| format!("检查失败: {}", e))?;

    let output = result.map_err(|e| format!("网络请求失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Err("无法连接到更新服务器".into());
    }

    let v: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("解析响应失败: {}", e))?;

    let tag = v
        .get("tag_name")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let html_url = v
        .get("html_url")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();

    Ok(UpdateInfo {
        has_update: !tag.is_empty() && tag != current,
        current,
        latest: tag,
        url: html_url,
        not_configured: false,
    })
}
