use crate::db::{
    now_iso, log_activity, db_agents, db_enabled_agents, AgentRow, DbState,
};
use rusqlite::params;
use tauri::State;

/// List all agents (including disabled), ordered by sort_order.
#[tauri::command]
pub fn get_agents(db: State<DbState>) -> Result<Vec<AgentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(db_agents(&conn))
}

/// Create or update an agent. If id matches an existing row, update; otherwise insert.
#[tauri::command]
pub fn save_agent(db: State<DbState>, agent: AgentRow) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ts = now_iso();
    conn.execute(
       "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color, auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label, skills_dir=excluded.skills_dir, config_dir=excluded.config_dir,
          mcp_config_file=excluded.mcp_config_file, color=excluded.color, auto_scan=excluded.auto_scan,
          scan_agents_dir=excluded.scan_agents_dir,
          enabled=excluded.enabled, sort_order=excluded.sort_order, updated_at=?11",
       params![
           agent.id,
           agent.label,
           agent.skills_dir,
           agent.config_dir,
           agent.mcp_config_file,
           agent.color,
           agent.auto_scan as i32,
           agent.scan_agents_dir as i32,
           agent.enabled as i32,
           agent.sort_order,
           ts,
       ],
    )
    .map_err(|e| e.to_string())?;
    log_activity(&conn, "agent_save", &agent.id);
    Ok(())
}

/// Toggle an agent enabled state.
#[tauri::command]
pub fn toggle_agent(db: State<DbState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agents SET enabled=?1, updated_at=?2 WHERE id=?3",
        params![enabled as i32, now_iso(), id],
    )
    .map_err(|e| e.to_string())?;
    log_activity(&conn, "agent_toggle", &format!("{} {}", id, if enabled { "on" } else { "off" }));
    Ok(())
}

/// Delete an agent. Built-in claude/codex cannot be deleted.
#[tauri::command]
pub fn delete_agent(db: State<DbState>, id: String) -> Result<(), String> {
    if id == "claude" || id == "codex" {
        return Err(format!("内置 agent {} 不可删除", id));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM connections WHERE runtime=?1", params![id]).ok();
    conn.execute("DELETE FROM agents WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_activity(&conn, "agent_delete", &id);
    Ok(())
}

/// Get the absolute mcp config file path for an agent.
#[tauri::command]
pub fn agent_mcp_path(db: State<DbState>, id: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agent = db_enabled_agents(&conn)
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("agent not found")?;
    let home = dirs::home_dir().unwrap_or_default();
    let path = home.join(&agent.mcp_config_file);
    Ok(path.to_string_lossy().to_string())
}
