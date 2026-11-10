use crate::db::{
    now_iso, log_activity, db_agents, AgentRow, DbState,
};
use rusqlite::params;
use tauri::State;

/// List all agents (including disabled), ordered by sort_order.
#[tauri::command]
pub fn get_agents(db: State<DbState>) -> Result<Vec<AgentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let home = dirs::home_dir();
    Ok(db_agents(&conn)
        .into_iter()
        .map(|agent| AgentRow {
            installed: home
                .as_ref()
                .map(|home| {
                    crate::agent_registry::agent_installed_at(home, &agent.skills_dir, &agent.config_dir)
                })
                .unwrap_or(false),
            ..agent
        })
        .collect())
}

/// Create or update an agent. If id matches an existing row, update; otherwise insert.
/// `enabled` 只在插入时生效；已存在的行走 toggle_agent，避免 UPSERT 静默覆盖启停状态。
#[tauri::command]
pub fn save_agent(db: State<DbState>, agent: AgentRow) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ts = now_iso();
    // color 列已废弃（纯视觉字段移除），保留 NOT NULL 列并写固定值
    conn.execute(
       "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color, auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
        VALUES (?1,?2,?3,?4,?5,'slate',?6,?7,?8,?9,?10,?10)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label, skills_dir=excluded.skills_dir, config_dir=excluded.config_dir,
          mcp_config_file=excluded.mcp_config_file, auto_scan=excluded.auto_scan,
          scan_agents_dir=excluded.scan_agents_dir,
          sort_order=excluded.sort_order, updated_at=?10",
       params![
           agent.id,
           agent.label,
           agent.skills_dir,
           agent.config_dir,
           agent.mcp_config_file,
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

/// Persist a full agent ordering (drag & drop). Atomic: single transaction,
/// no per-agent activity log noise.
#[tauri::command]
pub fn reorder_agents(db: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE agents SET sort_order=?1, updated_at=?2 WHERE id=?3",
            params![i as i64, now_iso(), id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete an agent. Built-in agents (per registry) cannot be deleted.
/// Also removes extensions rows owned by this agent to avoid orphans
/// (scan only covers enabled agents, so they would never be refreshed).
#[tauri::command]
pub fn delete_agent(db: State<DbState>, id: String) -> Result<(), String> {
    if crate::agent_registry::spec_by_id(&id)
        .map(|spec| spec.capabilities.builtin)
        .unwrap_or(false)
    {
        return Err(format!("内置 agent {} 不可删除", id));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM connections WHERE runtime=?1", params![id]).ok();
    conn.execute("DELETE FROM extensions WHERE runtime=?1", params![id]).ok();
    conn.execute("DELETE FROM agents WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_activity(&conn, "agent_delete", &id);
    Ok(())
}

/// Get the absolute mcp config file path for an agent.
#[tauri::command]
pub fn agent_mcp_path(db: State<DbState>, id: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::agent_config::mcp_target(&conn, &id)?.path)
}
