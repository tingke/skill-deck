use crate::db::{
    now_iso, log_activity, db_agents, ProjectRow, DbState,
};
use crate::scanner::scan_skill_dir;
use rusqlite::params;
use std::fs;
use std::path::PathBuf;
use tauri::State;


fn sanitize_id(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// List all projects with live skill count.
pub fn list_projects(conn: &rusqlite::Connection) -> Vec<ProjectRow> {
    let mut stmt = match conn.prepare(
        "SELECT id, name, path, color, sort_order, created_at, updated_at
         FROM projects ORDER BY name COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
        ))
    });
    let mut out: Vec<ProjectRow> = Vec::new();
    if let Ok(rows) = rows {
        for r in rows.flatten() {
            let (id, name, path, color, sort_order, created_at, updated_at) = r;
            // count skills belonging to this project
            let prefix = format!("project:{}:", id);
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM skills WHERE id LIKE ?1",
                    params![format!("{}%", prefix)],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            out.push(ProjectRow {
                id, name, path, color, sort_order, skill_count: count, created_at, updated_at,
            });
        }
    }
    out
}

/// Scan a single project: iterate all agents, look for <project>/<agent.skills_dir>/
pub fn scan_project_skills(
    conn: &rusqlite::Connection,
    project_id: &str,
    project_name: &str,
    project_path: &str,
) -> Vec<String> {
   let mut found_ids = Vec::new();
   let base = PathBuf::from(project_path);
   if !base.is_dir() {
       return found_ids;
   }

   // 按 canonical path 去重，避免多个 agent 扫描同一目录导致重复
   let mut seen: std::collections::HashMap<std::path::PathBuf, (crate::scanner::ScanResult, Vec<String>)> =
       std::collections::HashMap::new();

  for agent in db_agents(conn) {
      // 需要扫描的目录：agent 自己的 skills_dir + 可选的 .agents/skills
      let mut dirs_to_scan = vec![base.join(&agent.skills_dir)];
      if agent.scan_agents_dir {
          dirs_to_scan.push(base.join(".agents/skills"));
      }
      for skills_dir in &dirs_to_scan {
          let entries = match fs::read_dir(skills_dir) {
              Ok(e) => e,
              Err(_) => continue,
          };
          for entry in entries.flatten() {
              let path = entry.path();
              if !path.is_dir() {
                  continue;
              }
              let dir_name = path.file_name().unwrap().to_string_lossy().to_string();
              if dir_name.starts_with('.') {
                  continue;
              }
              if let Some(scan) = scan_skill_dir(&path, project_name) {
                  let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                  let entry = seen
                      .entry(canonical)
                      .or_insert_with(|| (scan, Vec::new()));
                  if !entry.1.contains(&agent.id) {
                      entry.1.push(agent.id.clone());
                  }
              }
          }
      }
  }

   // 写入去重后的 skill 及其连接
   for (_, (scan, agents)) in &seen {
       let id = format!("project:{}:{}", project_id, scan.original_dir);
       found_ids.push(id.clone());
       conn.execute(
           "INSERT INTO skills (id, name, source_lib, path, description, content_hash, enabled, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, source_lib=excluded.source_lib, path=excluded.path,
              description=excluded.description, content_hash=excluded.content_hash, updated_at=excluded.updated_at",
           params![id, scan.name, scan.source_lib, scan.path, scan.description, scan.content_hash, !scan.disabled as i32, now_iso(), now_iso()],
       ).ok();
       for agent_id in agents {
           conn.execute(
               "INSERT INTO connections (skill_id, runtime, linked, updated_at)
                VALUES (?1, ?2, 1, ?3)
                ON CONFLICT(skill_id, runtime) DO UPDATE SET linked = 1, updated_at = ?3",
               params![id, agent_id, now_iso()],
           ).ok();
       }
   }
  found_ids
}

// ============ tauri commands ============

#[tauri::command]
pub fn get_projects(db: State<DbState>) -> Result<Vec<ProjectRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(list_projects(&conn))
}

#[tauri::command]
pub fn save_project(
    db: State<DbState>,
    project: ProjectRow,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ts = now_iso();
    let id = if project.id.is_empty() {
        sanitize_id(&project.name)
    } else {
        project.id.clone()
    };
    conn.execute(
        "INSERT INTO projects (id, name, path, color, sort_order, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?6)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, path=excluded.path, color=excluded.color,
           sort_order=excluded.sort_order, updated_at=?6",
        params![id, project.name, project.path, project.color, project.sort_order, ts],
    )
    .map_err(|e| e.to_string())?;
    log_activity(&conn, "project_save", &project.name);
    Ok(())
}

#[tauri::command]
pub fn delete_project(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // delete skills belonging to this project
    let prefix = format!("project:{}:%", id);
    conn.execute("DELETE FROM skills WHERE id LIKE ?1", params![prefix]).ok();
    conn.execute("DELETE FROM projects WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_activity(&conn, "project_delete", &id);
    Ok(())
}

/// pick_folder is already in packages.rs, re-export here for convenience
#[tauri::command]
pub fn pick_project_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择项目目录")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}
