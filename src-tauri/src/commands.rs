use crate::db::{DbState, SkillRow, ActivityLog, PromptRow, RuleRow, RuntimeInfo, now_iso, log_activity, db_enabled_agents, AgentRow, LibrarySourceRow, db_library_sources, db_enabled_library_sources};
use crate::scanner;
use crate::projects;
use crate::skill_connections::{
    self, SkillConnectionState,
};
use rusqlite::params;
use std::fs;
use std::path::PathBuf;
use std::path::Path;
use serde::Serialize;
use tauri::State;

/// Look up an enabled agent config from DB by id.
fn db_agent_by_id(conn: &rusqlite::Connection, id: &str) -> Option<AgentRow> {
    db_enabled_agents(conn).into_iter().find(|a| a.id == id)
}


/// 在访达中定位（高亮）给定文件/目录。无论入口是文件还是目录，都在父目录中选中它。
fn open_reveal_arguments() -> [&'static str; 1] {
    ["-R"]
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    let mut cmd = std::process::Command::new("open");
    cmd.args(open_reveal_arguments());
    cmd.arg(&path);
    cmd.status().map_err(|e| format!("打开访达失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_home_directory() -> String {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 返回所有 runtime 配置（id, label, color, default_dir）
/// 返回所有 runtime 配置（id, label, color, default_dir）
#[tauri::command]
pub fn get_runtimes(db: State<DbState>) -> Result<Vec<RuntimeInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(db_enabled_agents(&conn)
        .into_iter()
        .map(|a| RuntimeInfo {
            id: a.id,
            label: a.label,
            color: a.color,
            default_dir: dirs::home_dir()
                .unwrap()
                .join(&a.skills_dir)
                .to_string_lossy()
                .to_string(),
           auto_scan: a.auto_scan,
           scan_agents_dir: a.scan_agents_dir,
           config_dir: a.config_dir,
           mcp_config_file: a.mcp_config_file,
           enabled: a.enabled,
           sort_order: a.sort_order,
        })
        .collect())
}

/// 同步 DB 连接状态与实际文件系统：扫描所有 runtime 的 skills 目录，
/// 如果 symlink 存在但 DB 未标记为 linked（或反之），修正 DB
#[tauri::command]
pub fn verify_connections(db: State<DbState>) -> Result<Vec<SkillRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agents = db_enabled_agents(&conn);
    let skills = scanner::get_all_skills(&conn);
    skill_connections::sync_skill_connections(&conn, &skills, &agents)?;

    Ok(scanner::get_all_skills(&conn))
}

#[tauri::command]
pub fn get_skill_connections(
    db: State<DbState>,
    skill_id: String,
) -> Result<Vec<SkillConnectionState>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let skill = skill_connections::get_skill(&conn, &skill_id)?;
    let agents = db_enabled_agents(&conn);
    Ok(skill_connections::skill_connection_states(
        &conn,
        &skill,
        &agents,
    ))
}

#[tauri::command]
pub fn adopt_real_entry(
    db: State<DbState>,
    skill_id: String,
    agent_id: String,
    library_source_id: String,
) -> Result<SkillConnectionState, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let state = skill_connections::adopt_real_entry(
        &conn,
        &skill_id,
        &agent_id,
        &library_source_id,
    )?;
    log_activity(
        &conn,
        "adopt_skill",
        &format!(
            "{} -> {}",
            state.entry_path,
            state.target_path.as_ref().unwrap_or(&String::new())
        ),
    );
    Ok(state)
}

/// 获取 Runtime 的 skills 目录（默认 ~/.<agent>/skills）
pub(crate) fn runtime_skills_dir(runtime: &str, conn: &rusqlite::Connection) -> PathBuf {
    let key = format!("{}_skills_dir", runtime);
    let default = db_agent_by_id(conn, runtime)
        .map(|a| dirs::home_dir().unwrap().join(&a.skills_dir))
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(runtime));
    let custom: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
             params![key],
             |row| row.get(0),
         )
         .ok();
     match custom {
         Some(p) => PathBuf::from(p),
         None => default,
     }
}

 /// 扫描所有 runtime 目录，刷新 skill 列表
 #[tauri::command]
pub fn scan_all(db: State<DbState>, log: Option<bool>) -> Result<Vec<SkillRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 备份现有 path→tags，防止 skill id 变化时标签丢失
    let mut path_tags: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT path, tags FROM skills WHERE tags IS NOT NULL AND tags != '[]'") {
        if let Ok(rows) = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
            for r in rows.flatten() {
                path_tags.insert(r.0, r.1);
            }
        }
    }

    // 扫描所有已启用的库源目录
    let mut found_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for lib in db_enabled_library_sources(&conn) {
        let dir = if lib.path.starts_with("/") {
            std::path::PathBuf::from(&lib.path)
        } else {
            dirs::home_dir().unwrap_or_default().join(&lib.path)
        };
        found_ids.extend(scanner::scan_library_source(&conn, &lib.id, &lib.name, &dir.to_string_lossy()));
    }

    // 扫描所有项目目录下各 agent 的 skills（遍历 <project>/<agent.skills_dir>）
    {
        let mut stmt = conn.prepare("SELECT id, name, path FROM projects").map_err(|e| e.to_string())?;
        let projs: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (pid, pname, ppath) in &projs {
            found_ids.extend(projects::scan_project_skills(&conn, pid, pname, ppath));
        }
    }

    // 把备份的 tags 按 path 还原到新扫描出的 skill 行（应对 id 前缀变化的场景）
    if !path_tags.is_empty() {
        let mut stmt = conn.prepare("SELECT id, path FROM skills").map_err(|e| e.to_string())?;
        let new_rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (id, path) in &new_rows {
            if let Some(tags) = path_tags.get(path) {
                conn.execute("UPDATE skills SET tags = ?1 WHERE id = ?2 AND tags = '[]'", params![tags, id]).ok();
            }
        }
    }

    // 清理不再存在的 skill 及其 connections（orphan cleanup）
    let stale: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM skills").map_err(|e| e.to_string())?;
        let rows: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|id| !found_ids.contains(id))
            .collect();
        rows
    };
    for id in &stale {
        conn.execute("DELETE FROM connections WHERE skill_id = ?1", params![id]).ok();
        conn.execute("DELETE FROM skills WHERE id = ?1", params![id]).ok();
    }

    let skills = scanner::get_all_skills(&conn);
    if log.unwrap_or(false) {
        log_activity(&conn, "scan", &format!("扫描完成，共 {} 个 skill", skills.len()));
    }
    Ok(skills)
 }

 /// 获取所有 skill
 #[tauri::command]
 pub fn get_skills(db: State<DbState>) -> Result<Vec<SkillRow>, String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;
     Ok(scanner::get_all_skills(&conn))
 }

 /// 接线一个 skill 到指定 Runtime（建 symlink）
 #[tauri::command]
pub fn connect_skill(
    db: State<DbState>,
    skill_id: String,
     agent_id: String,
) -> Result<(), String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;
     skill_connections::connect_skill_connection(&conn, &skill_id, &agent_id)?;
     let name: String = conn
         .query_row("SELECT name FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
         .unwrap_or_else(|_| skill_id.clone());
     log_activity(&conn, "connect", &format!("{} -> {}", name, agent_id));
     Ok(())
}

 /// 断开一个 skill 的连接（删 symlink）
 #[tauri::command]
pub fn disconnect_skill(
     db: State<DbState>,
     skill_id: String,
     agent_id: String,
     confirmed_shared: bool,
) -> Result<(), String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;
     skill_connections::disconnect_skill_connection(
         &conn,
         &skill_id,
         &agent_id,
         confirmed_shared,
     )?;
     let name: String = conn
         .query_row("SELECT name FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
         .unwrap_or_else(|_| skill_id.clone());
     log_activity(&conn, "disconnect", &format!("{} x {}", name, agent_id));
     Ok(())
}

 /// 批量接线/断开（用于预设切换）
 #[tauri::command]
pub fn batch_connect(
     db: State<DbState>,
     connect_ids: Vec<String>,
    disconnect_ids: Vec<String>,
    agent_id: String,
    confirmed_shared: bool,
) -> Result<(), String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;

     for skill_id in &connect_ids {
         skill_connections::connect_skill_connection(&conn, skill_id, &agent_id)?;
     }

     for skill_id in &disconnect_ids {
         skill_connections::disconnect_skill_connection(
            &conn,
            skill_id,
            &agent_id,
            confirmed_shared,
         )?;
     }

     log_activity(&conn, "batch", &format!("+{} -{} ({})", connect_ids.len(), disconnect_ids.len(), agent_id));
     Ok(())
}

 /// 读取 SKILL.md 内容
 #[tauri::command]
 pub fn read_skill_file(db: State<DbState>, skill_id: String) -> Result<String, String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;
     let path: String = conn
         .query_row("SELECT path FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
         .map_err(|_| "skill not found".to_string())?;

    let skill_md = skill_connections::active_manifest_path(Path::new(&path))
        .ok_or_else(|| "skill manifest not found".to_string())?;
    fs::read_to_string(&skill_md).map_err(|e| format!("读取失败: {}", e))
 }

 /// 写入 SKILL.md 内容
 #[tauri::command]
 pub fn write_skill_file(db: State<DbState>, skill_id: String, content: String) -> Result<(), String> {
     let conn = db.0.lock().map_err(|e| e.to_string())?;
     let path: String = conn
         .query_row("SELECT path FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
         .map_err(|_| "skill not found".to_string())?;

    let skill_md = skill_connections::active_manifest_path(Path::new(&path))
        .ok_or_else(|| "skill manifest not found".to_string())?;
    fs::write(&skill_md, &content).map_err(|e| format!("写入失败: {}", e))?;
     Ok(())
 }

/// 获取最近活动日志
#[tauri::command]
pub fn get_recent_activity(db: State<DbState>) -> Result<Vec<ActivityLog>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, action, detail, created_at FROM activity_log ORDER BY id DESC LIMIT 10")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ActivityLog {
                id: row.get(0)?,
                action: row.get(1)?,
                detail: row.get(2)?,
                created_at: row.get::<_, String>(3).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ===================== Skill management =====================

/// 删除 skill：删除实际目录 + 移除所有 runtime 的 symlink + 清理 DB
#[tauri::command]
pub fn delete_skill(db: State<DbState>, skill_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let path: String = conn
        .query_row("SELECT path FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
        .map_err(|_| "skill not found".to_string())?;
    let name: String = conn
        .query_row("SELECT name FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
        .unwrap_or_else(|_| skill_id.clone());

    // 移除所有 runtime 的 symlink
    for rt in db_enabled_agents(&conn) {
        let dir = runtime_skills_dir(&rt.id, &conn);
        let dir_name = std::path::Path::new(&path)
            .file_name().unwrap_or_default().to_string_lossy().to_string();
        let sym = dir.join(&dir_name);
        if sym.is_symlink() { fs::remove_file(&sym).ok(); }
    }

    // 删除实际目录
    fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败: {}", e))?;

    // 清理 DB
    conn.execute("DELETE FROM connections WHERE skill_id = ?1", params![skill_id]).ok();
    conn.execute("DELETE FROM skills WHERE id = ?1", params![skill_id]).ok();

    log_activity(&conn, "delete", &name);
    Ok(())
}

/// 更新 skill 标签
#[tauri::command]
pub fn update_skill_tags(db: State<DbState>, skill_id: String, tags: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    conn.execute("UPDATE skills SET tags = ?1, updated_at = ?2 WHERE id = ?3", params![tags_json, now_iso(), skill_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换 skill 的启用/停用状态（只重命名 manifest，不改变任何连接）
#[tauri::command]
pub fn toggle_skill_enabled(db: State<DbState>, skill_id: String, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row(
            "SELECT path FROM skills WHERE id = ?1",
            params![skill_id],
            |row| row.get(0),
        )
        .map_err(|_| "skill not found".to_string())?;

    rename_skill_manifest(Path::new(&path), enabled)?;

    let name: String = conn
        .query_row("SELECT name FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
        .unwrap_or_else(|_| skill_id.clone());
    conn.execute(
        "UPDATE skills SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i32, now_iso(), skill_id],
    )
    .map_err(|e| e.to_string())?;
    let flag = if enabled { 1 } else { 0 };
    log_activity(&conn, "toggle_skill", &format!("{} skill: {}", if flag == 1 { "启用" } else { "停用" }, name));
    Ok(())
}

fn rename_skill_manifest(skill_path: &Path, enabled: bool) -> Result<(), String> {
    let active = skill_path.join("SKILL.md");
    let disabled = skill_path.join("SKILL.md.disabled");
    let active_exists = active.is_file();
    let disabled_exists = disabled.is_file();

    if active_exists && disabled_exists {
        return Err(format!(
            "{:?} 同时存在 SKILL.md 和 SKILL.md.disabled，请先清理后重试",
            skill_path
        ));
    }
    if !active_exists && !disabled_exists {
        return Err(format!("{:?} 缺少 SKILL.md 或 SKILL.md.disabled", skill_path));
    }

    if enabled && disabled_exists {
        fs::rename(&disabled, &active).map_err(|e| format!("启用 skill 失败: {}", e))?;
    } else if !enabled && active_exists {
        fs::rename(&active, &disabled).map_err(|e| format!("停用 skill 失败: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod manifest_tests {
    use super::*;
    use std::os::unix::fs::symlink;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "skill-deck-manifest-{}-{}",
                label,
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reveal_arguments_highlight_directories_and_files() {
        assert_eq!(open_reveal_arguments(), ["-R"]);
    }

    #[test]
    fn renaming_manifest_preserves_existing_connections() {
        let root = TempDir::new("preserve-links");
        let skill = root.0.join("test");
        let link = root.0.join("agent-link");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        symlink(&skill, &link).unwrap();

        rename_skill_manifest(&skill, false).unwrap();
        assert!(!skill.join("SKILL.md").exists());
        assert!(skill.join("SKILL.md.disabled").is_file());
        assert!(link.is_symlink());

        rename_skill_manifest(&skill, true).unwrap();
        assert!(skill.join("SKILL.md").is_file());
        assert!(!skill.join("SKILL.md.disabled").exists());
        assert!(link.is_symlink());
    }

    #[test]
    fn renaming_manifest_rejects_ambiguous_and_missing_state() {
        let root = TempDir::new("invalid-state");
        let missing = root.0.join("missing");
        let both = root.0.join("both");
        fs::create_dir_all(&missing).unwrap();
        fs::create_dir_all(&both).unwrap();
        fs::write(both.join("SKILL.md"), "active").unwrap();
        fs::write(both.join("SKILL.md.disabled"), "disabled").unwrap();

        assert!(rename_skill_manifest(&missing, true).is_err());
        assert!(rename_skill_manifest(&both, false).is_err());
    }
}

/// List files in a skill directory (recursive tree)
#[derive(Serialize)]
pub struct SkillFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub children: Vec<SkillFileEntry>,
}

fn build_file_tree(dir: &Path, base: &Path) -> Vec<SkillFileEntry> {
    let mut entries: Vec<SkillFileEntry> = Vec::new();
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return entries,
    };
    for entry in read.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let relative = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let size = meta.len();
        let children = if is_dir {
            build_file_tree(&path, base)
        } else {
            Vec::new()
        };
        entries.push(SkillFileEntry { name, path: relative, is_dir, size, children });
    }
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });
    entries
}

/// List all files in a skill directory as a tree
#[tauri::command]
pub fn list_skill_files(db: State<DbState>, skill_id: String) -> Result<Vec<SkillFileEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row("SELECT path FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
        .map_err(|_| "skill not found".to_string())?;
    let dir = PathBuf::from(&path);
    Ok(build_file_tree(&dir, &dir))
}

/// Read a specific file in a skill directory by relative path
#[tauri::command]
pub fn read_skill_file_path(db: State<DbState>, skill_id: String, file_path: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let base: String = conn
        .query_row("SELECT path FROM skills WHERE id = ?1", params![skill_id], |row| row.get(0))
        .map_err(|_| "skill not found".to_string())?;
    let full = PathBuf::from(&base).join(&file_path);
    let canonical_base = PathBuf::from(&base).canonicalize().map_err(|e| e.to_string())?;
    let canonical_full = full.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_full.starts_with(&canonical_base) {
        return Err("path outside skill directory".to_string());
    }
    std::fs::read_to_string(&canonical_full).map_err(|e| format!("读取失败: {}", e))
}

// ===================== Library Sources (库源) =====================

#[tauri::command]
pub fn get_library_sources(db: State<DbState>) -> Result<Vec<LibrarySourceRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(db_library_sources(&conn))
}

#[tauri::command]
pub fn save_library_source(db: State<DbState>, source: LibrarySourceRow) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ts = now_iso();
    conn.execute(
        "INSERT INTO library_sources (id, name, path, enabled, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, path=excluded.path, enabled=excluded.enabled,
           sort_order=excluded.sort_order, updated_at=?6",
        params![source.id, source.name, source.path, source.enabled as i32, source.sort_order, ts],
    )
    .map_err(|e| e.to_string())?;
    log_activity(&conn, "library_source_save", &source.name);
    Ok(())
}

#[tauri::command]
pub fn delete_library_source(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // 删除该库源下的所有 skill 及其 connections
    let skill_ids: Vec<String> = {
        let prefix = format!("{}:", id);
        let mut stmt = conn.prepare("SELECT id FROM skills WHERE id LIKE ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&prefix], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for sid in &skill_ids {
        conn.execute("DELETE FROM connections WHERE skill_id = ?1", params![sid]).ok();
        conn.execute("DELETE FROM skills WHERE id = ?1", params![sid]).ok();
    }
    conn.execute("DELETE FROM library_sources WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    log_activity(&conn, "library_source_delete", &id);
    Ok(())
}

// ===================== Prompts =====================

#[tauri::command]
pub fn get_prompts(db: State<DbState>) -> Result<Vec<PromptRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, tags, source FROM prompts ORDER BY title COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let tags_str: String = row.get::<_, String>(3).unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(PromptRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags,
                source: row.get::<_, String>(4).unwrap_or_else(|_| "manual".into()),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_prompt(
    db: State<DbState>,
    id: Option<i64>,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<PromptRow, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    match id {
        Some(i) => {
            conn.execute(
                "UPDATE prompts SET title=?1, content=?2, tags=?3, updated_at=?4 WHERE id=?5",
                params![title, content, tags_json, now_iso(), i],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptRow { id: i, title, content, tags, source: "manual".into() })
        }
        None => {
            conn.execute(
                "INSERT INTO prompts (title, content, tags, source, created_at, updated_at) VALUES (?1,?2,?3,'manual',?4,?4)",
                params![title, content, tags_json, now_iso()],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptRow {
                id: conn.last_insert_rowid(),
                title,
                content,
                tags,
                source: "manual".into(),
            })
        }
    }
}

#[tauri::command]
pub fn delete_prompt(db: State<DbState>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM prompts WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ===================== Rules =====================

#[tauri::command]
pub fn get_rules(db: State<DbState>) -> Result<Vec<RuleRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, platform, target_path, tags, source FROM rules ORDER BY title COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let tags_str: String = row.get::<_, String>(5).unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(RuleRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                platform: row.get::<_, String>(3).unwrap_or_else(|_| "claude".into()),
                target_path: row.get(4).ok(),
                tags,
                source: row.get::<_, String>(6).unwrap_or_else(|_| "manual".into()),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_rule(
    db: State<DbState>,
    id: Option<i64>,
    title: String,
    content: String,
    platform: String,
    target_path: Option<String>,
    tags: Vec<String>,
) -> Result<RuleRow, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    match id {
        Some(i) => {
            conn.execute(
                "UPDATE rules SET title=?1, content=?2, platform=?3, target_path=?4, tags=?5, updated_at=?6 WHERE id=?7",
                params![title, content, platform, target_path, tags_json, now_iso(), i],
            )
            .map_err(|e| e.to_string())?;
            Ok(RuleRow { id: i, title, content, platform, target_path, tags, source: "manual".into() })
        }
        None => {
            conn.execute(
                "INSERT INTO rules (title, content, platform, target_path, tags, source, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)",
                params![title, content, platform, target_path, tags_json, now_iso()],
            )
            .map_err(|e| e.to_string())?;
            Ok(RuleRow {
                id: conn.last_insert_rowid(),
                title, content, platform, target_path, tags,
                source: "manual".into(),
            })
        }
    }
}

#[tauri::command]
pub fn delete_rule(db: State<DbState>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rules WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
// ===================== Rules: write-to-disk + scan =====================

/// Expand a leading ~ to the user's home directory.
fn expand_home(s: &str) -> String {
    if s.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.to_string_lossy(), &s[1..]);
        }
    }
    s.to_string()
}

/// Shared query: read all rules ordered by title.
fn query_rules(conn: &rusqlite::Connection) -> Vec<RuleRow> {
    let mut stmt = match conn.prepare(
        "SELECT id, title, content, platform, target_path, tags, source FROM rules ORDER BY title COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| {
        let tags_str: String = row.get::<_, String>(5).unwrap_or_else(|_| "[]".into());
        let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
        Ok(RuleRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            platform: row.get::<_, String>(3).unwrap_or_else(|_| "claude".into()),
            target_path: row.get(4).ok(),
            tags,
            source: row.get::<_, String>(6).unwrap_or_else(|_| "manual".into()),
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Write (merge) a rule's content into its target file. Idempotent.
#[tauri::command]
pub fn apply_rule(db: State<DbState>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (title, content, target_path, platform): (String, String, Option<String>, String) = conn
        .query_row(
            "SELECT title, content, target_path, platform FROM rules WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "rule not found".to_string())?;
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let raw = target_path.as_ref().map(|s| s.as_str()).unwrap_or("");
    let expanded = expand_home(raw);
    let target = if !expanded.is_empty() {
        PathBuf::from(expanded)
    } else {
        match platform.as_str() {
            "codex" => home.join(".codex").join("AGENTS.md"),
            _ => home.join(".claude").join("CLAUDE.md"),
        }
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
        let header = format!("\n<!-- SkillDeck · {} -->\n", title);
    if target.exists() {
        let existing = fs::read_to_string(&target).unwrap_or_default();
        let marker = content.trim();
        if !marker.is_empty() && existing.contains(marker) {
            return Ok(target.to_string_lossy().to_string());
        }
        let merged = format!("{}\n{}{}\n", existing.trim_end(), header, content);
        fs::write(&target, merged).map_err(|e| e.to_string())?;
    } else {
        let body = format!("{}{}\n", header, content);
        fs::write(&target, body).map_err(|e| e.to_string())?;
    }
    log_activity(&conn, "rule_apply", &title);
    Ok(target.to_string_lossy().to_string())
}

/// Insert or update a scanned rule, deduping by target_path. Returns 1 if new.
fn upsert_scanned_rule(
    conn: &rusqlite::Connection,
    title: &str,
    content: &str,
    platform: &str,
    abs_path: &str,
) -> Result<i64, String> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM rules WHERE target_path = ?1",
            params![abs_path],
            |row| row.get(0),
        )
        .ok();
    match existing {
        Some(eid) => {
            conn.execute(
                "UPDATE rules SET title=?1, content=?2, platform=?3, updated_at=?4 WHERE id=?5",
                params![title, content, platform, now_iso(), eid],
            )
            .map_err(|e| e.to_string())?;
            Ok(0)
        }
        None => {
            conn.execute(
                "INSERT INTO rules (title, content, platform, target_path, tags, source, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, '[]', 'scan', ?5, ?5)",
                params![title, content, platform, abs_path, now_iso()],
            )
            .map_err(|e| e.to_string())?;
            Ok(1)
        }
    }
}

/// Scan each agent's config dir for rule files and import into the rules table.
#[tauri::command]
pub fn scan_rules(db: State<DbState>) -> Result<Vec<RuleRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agents = db_enabled_agents(&conn);
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut new_count = 0i64;
    for agent in &agents {
        let config_path = PathBuf::from(expand_home(&agent.config_dir));
        let files: Vec<&str> = match agent.id.as_str() {
            "claude" => vec!["CLAUDE.md"],
            "codex" => vec!["AGENTS.md"],
            _ => vec!["CLAUDE.md", "AGENTS.md"],
        };
        for file_name in &files {
            let fp = config_path.join(file_name);
            if !fp.is_file() { continue; }
            let content = match fs::read_to_string(&fp) { Ok(c) => c, Err(_) => continue };
            let abs = fp.to_string_lossy().to_string();
            let title = format!("{} · {}", agent.label, file_name);
            new_count += upsert_scanned_rule(&conn, &title, &content, &agent.id, &abs)?;
        }
    }
    let cursorrules = home.join(".cursorrules");
    if cursorrules.is_file() {
        if let Ok(content) = fs::read_to_string(&cursorrules) {
            let abs = cursorrules.to_string_lossy().to_string();
            new_count += upsert_scanned_rule(&conn, "Cursor · .cursorrules", &content, "cursor", &abs)?;
        }
    }
    let cursor_rules_dir = home.join(".cursor").join("rules");
    if cursor_rules_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&cursor_rules_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) != Some("mdc") { continue; }
                let content = match fs::read_to_string(&p) { Ok(c) => c, Err(_) => continue };
                let fname = p.file_name().unwrap().to_string_lossy().to_string();
                let abs = p.to_string_lossy().to_string();
                new_count += upsert_scanned_rule(&conn, &format!("Cursor · {}", fname), &content, "cursor", &abs)?;
            }
        }
    }
    log_activity(&conn, "rule_scan", &format!("扫描完成，新增 {} 条", new_count));
    Ok(query_rules(&conn))
}
