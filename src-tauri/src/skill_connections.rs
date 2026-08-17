use crate::db::{AgentRow, SkillRow};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::os::unix::fs::symlink;
use std::fs;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Symlink,
    RealDirectory,
    RealFile,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionProbe {
    pub agent_id: String,
    pub entry_path: String,
    pub kind: ConnectionKind,
    pub target_path: Option<String>,
    pub skill_id: String,
    pub enabled: bool,
    pub shared: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillConnectionState {
    pub agent_id: String,
    pub agent_label: String,
    pub kind: ConnectionKind,
    pub entry_path: String,
    pub target_path: Option<String>,
    pub enabled: bool,
    pub shared: bool,
    pub affected_agents: Vec<String>,
}

pub(crate) fn agent_skills_path(agent: &AgentRow) -> PathBuf {
    let configured = PathBuf::from(&agent.skills_dir);
    if configured.is_absolute() {
        configured
    } else {
        dirs::home_dir().unwrap_or_default().join(configured)
    }
}

pub(crate) fn active_manifest_path(skill_path: &Path) -> Option<PathBuf> {
    if skill_path.join("SKILL.md").is_file() {
        Some(skill_path.join("SKILL.md"))
    } else if skill_path.join("SKILL.md.disabled").is_file() {
        Some(skill_path.join("SKILL.md.disabled"))
    } else {
        None
    }
}

pub fn probe_agent_entries(agent: &AgentRow, skills: &[SkillRow]) -> Vec<ConnectionProbe> {
    probe_directory_entries(&agent.id, &agent_skills_path(agent), false, skills)
}

pub fn probe_directory_entries(
    agent_id: &str,
    directory: &Path,
    shared: bool,
    skills: &[SkillRow],
) -> Vec<ConnectionProbe> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut probes: Vec<ConnectionProbe> = entries
        .flatten()
        .filter_map(|entry| {
            let entry_path = entry.path();
            let entry_name = entry_path.file_name()?.to_string_lossy().to_string();
            let metadata = fs::symlink_metadata(&entry_path).ok()?;
            let kind = if metadata.file_type().is_symlink() {
                ConnectionKind::Symlink
            } else if metadata.is_dir() {
                ConnectionKind::RealDirectory
            } else {
                ConnectionKind::RealFile
            };

            let target_path = fs::canonicalize(&entry_path).ok();

            let skill = skills.iter().find(|skill| {
                let skill_path = PathBuf::from(&skill.path);
                let name_matches = skill_path
                    .file_name()
                    .map(|name| name.to_string_lossy() == entry_name)
                    .unwrap_or(false);
                let target_matches = fs::canonicalize(&skill_path)
                    .map(|canonical| Some(canonical) == target_path)
                    .unwrap_or(false);
                name_matches || target_matches
            })?;

            let enabled = target_path
                .as_ref()
                .map(|path| path.join("SKILL.md").is_file())
                .unwrap_or(false);
            Some(ConnectionProbe {
                agent_id: agent_id.to_string(),
                entry_path: entry_path.to_string_lossy().to_string(),
                kind,
                target_path: target_path
                    .map(|path| path.to_string_lossy().to_string()),
                skill_id: skill.id.clone(),
                enabled,
                shared,
            })
        })
        .collect();

    probes.sort_by(|a, b| a.entry_path.cmp(&b.entry_path));
    probes
}

pub(crate) fn configured_agent_skills_path(
    conn: &Connection,
    agent: &AgentRow,
) -> PathBuf {
    let configured = agent_skills_path(agent);
    let custom: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![format!("{}_skills_dir", agent.id)],
            |row| row.get(0),
        )
        .ok();
    custom.map(PathBuf::from).unwrap_or(configured)
}

pub fn all_connection_probes(
    conn: &Connection,
    skills: &[SkillRow],
    agents: &[AgentRow],
) -> Vec<ConnectionProbe> {
    let mut probes = Vec::new();
    let mut private_dirs = HashSet::new();

    for agent in agents {
        let path = configured_agent_skills_path(conn, agent);
        private_dirs.insert(path.clone());
        probes.extend(probe_agent_entries(&agent.clone(), skills));
    }

    let mut shared_dirs = HashSet::new();
    if let Some(global) = dirs::home_dir().map(|home| home.join(".agents").join("skills")) {
        shared_dirs.insert(global);
    }
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM projects") {
        if let Ok(paths) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for project_path in paths.flatten() {
                let base = PathBuf::from(project_path);
                let path = if base.is_absolute() {
                    base
                } else {
                    dirs::home_dir().unwrap_or_default().join(base)
                };
                shared_dirs.insert(path.join(".agents").join("skills"));
            }
        }
    }

    for directory in shared_dirs {
        if private_dirs.contains(&directory) {
            continue;
        }
        for agent in agents.iter().filter(|agent| agent.scan_agents_dir) {
            probes.extend(probe_directory_entries(
                &agent.id,
                &directory,
                true,
                skills,
            ));
        }
    }

    probes.sort_by(|a, b| a.entry_path.cmp(&b.entry_path));
    probes
}

pub fn skill_connection_states(
    conn: &Connection,
    skill: &SkillRow,
    agents: &[AgentRow],
) -> Vec<SkillConnectionState> {
    let skill_rows = [skill.clone()];
    let probes = all_connection_probes(conn, &skill_rows, agents);
    let mut grouped: HashMap<String, Vec<ConnectionProbe>> = HashMap::new();
    for probe in probes.into_iter().filter(|probe| probe.skill_id == skill.id) {
        grouped.entry(probe.agent_id.clone()).or_default().push(probe);
    }

    let mut states = Vec::new();
    for (agent_id, mut entries) in grouped {
        entries.sort_by_key(|probe| probe.shared);
        let probe = entries
            .first()
            .expect("grouped connection entries must not be empty")
            .clone();
        let affected_agents: Vec<String> = if probe.shared {
            entries
                .iter()
                .filter(|entry| entry.entry_path == probe.entry_path)
                .map(|entry| entry.agent_id.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect()
        } else {
            vec![agent_id.clone()]
        };
        let agent_label = agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .map(|agent| agent.label.clone())
            .unwrap_or_else(|| agent_id.clone());

        states.push(SkillConnectionState {
            agent_id,
            agent_label,
            kind: probe.kind,
            entry_path: probe.entry_path,
            target_path: probe.target_path,
            enabled: probe.enabled,
            shared: probe.shared,
            affected_agents,
        });
    }
    states.sort_by(|a, b| a.agent_label.cmp(&b.agent_label));
    states
}

pub fn sync_skill_connections(
    conn: &Connection,
    skills: &[SkillRow],
    agents: &[AgentRow],
) -> Result<(), String> {
    let probes = all_connection_probes(conn, skills, agents);
    for skill in skills {
        for agent in agents {
            let matching: Vec<&ConnectionProbe> = probes
                .iter()
                .filter(|probe| probe.skill_id == skill.id && probe.agent_id == agent.id)
                .collect();
            if let Some(probe) = matching
                .iter()
                .find(|probe| probe.enabled)
                .or_else(|| matching.first())
            {
                    conn.execute(
                        "INSERT INTO connections (skill_id, runtime, linked, symlink_path, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(skill_id, runtime) DO UPDATE SET
                            linked=excluded.linked, symlink_path=excluded.symlink_path,
                            updated_at=excluded.updated_at",
                        params![
                            skill.id,
                            agent.id,
                            probe.enabled as i32,
                            probe.entry_path,
                            crate::db::now_iso()
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO connections (skill_id, runtime, linked, symlink_path, updated_at)
                     VALUES (?1, ?2, 0, '', ?3)
                     ON CONFLICT(skill_id, runtime) DO UPDATE SET
                        linked=0, symlink_path='', updated_at=excluded.updated_at",
                    params![skill.id, agent.id, crate::db::now_iso()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn disconnect_skill_connection(
    conn: &Connection,
    skill_id: &str,
    agent_id: &str,
    confirmed_shared: bool,
) -> Result<(), String> {
    let skill = get_skill(conn, skill_id)?;
    let agents = crate::db::db_enabled_agents(conn);
    let skill_rows = [skill.clone()];
    let all_probes = all_connection_probes(conn, &skill_rows, &agents);
    let selected: Vec<ConnectionProbe> = all_probes
        .into_iter()
        .filter(|probe| probe.skill_id == skill_id && probe.agent_id == agent_id)
        .collect();
    if selected.is_empty() {
        return Err(format!("Agent {} 未连接 skill {}", agent_id, skill.name));
    }

    if let Some(real) = selected.iter().find(|probe| {
        probe.kind == ConnectionKind::RealDirectory || probe.kind == ConnectionKind::RealFile
    }) {
        let label = match real.kind {
            ConnectionKind::RealDirectory => "真实目录",
            ConnectionKind::RealFile => "真实文件",
            _ => "真实入口",
        };
        return Err(format!("{} 不能通过断开连接删除：{}", label, real.entry_path));
    }

    let shared_paths: HashSet<String> = selected
        .iter()
        .filter(|probe| probe.shared)
        .map(|probe| probe.entry_path.clone())
        .collect();
    let mut affected_agents: HashSet<String> = selected
        .iter()
        .filter(|probe| !probe.shared)
        .map(|probe| probe.agent_id.clone())
        .collect();
    for path in &shared_paths {
        let agents_on_path: Vec<String> = all_connection_probes(
            conn,
            &skill_rows,
            &agents,
        )
        .into_iter()
        .filter(|probe| probe.entry_path == *path)
        .map(|probe| probe.agent_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
        affected_agents.extend(agents_on_path);
    }

    if !shared_paths.is_empty()
        && affected_agents.len() > 1
        && !confirmed_shared
    {
        let labels = affected_agents
            .iter()
            .filter_map(|id| agents.iter().find(|agent| &agent.id == id))
            .map(|agent| agent.label.as_str())
            .collect::<Vec<_>>()
            .join("、");
        return Err(format!("CONFIRM_SHARED:{}:{}", skill.name, labels));
    }

    let mut paths = shared_paths;
    for probe in &selected {
        if !probe.shared {
            paths.insert(probe.entry_path.clone());
        }
    }
    for path in &paths {
        let entry = PathBuf::from(path);
        if fs::symlink_metadata(&entry)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
        {
            fs::remove_file(&entry).map_err(|e| format!("无法删除共享链接 {}: {}", path, e))?;
        }
    }

    for agent in affected_agents {
        conn.execute(
            "UPDATE connections SET linked=0, symlink_path='', updated_at=?1
             WHERE skill_id=?2 AND runtime=?3",
            params![crate::db::now_iso(), skill_id, agent],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn connect_skill_connection(
    conn: &Connection,
    skill_id: &str,
    agent_id: &str,
) -> Result<(), String> {
    let skill = get_skill(conn, skill_id)?;
    let agents = crate::db::db_enabled_agents(conn);
    let agent = agents
        .iter()
        .find(|agent| agent.id == agent_id)
        .ok_or_else(|| format!("agent not found: {}", agent_id))?;
    let skill_path = fs::canonicalize(&skill.path).map_err(|e| e.to_string())?;
    let destination = configured_agent_skills_path(conn, agent);
    let entry_name = skill_path
        .file_name()
        .ok_or_else(|| format!("invalid skill path: {}", skill.path))?;
    let link_path = destination.join(entry_name);

    if let Ok(metadata) = fs::symlink_metadata(&link_path) {
        if metadata.file_type().is_symlink() {
            let current_target = fs::canonicalize(&link_path).ok();
            if current_target.as_ref() == Some(&skill_path) {
                let linked = skill_path.join("SKILL.md").is_file();
                update_connection_cache(conn, skill_id, agent_id, linked, &link_path)?;
                return Ok(());
            }
            return Err(format!(
                "目标已存在软链但指向不同 skill：{}",
                link_path.to_string_lossy()
            ));
        }
        if metadata.is_dir() {
            return Err(format!(
                "真实目录不能被覆盖：{}",
                link_path.to_string_lossy()
            ));
        }
        return Err(format!(
            "真实文件不能被覆盖：{}",
            link_path.to_string_lossy()
        ));
    }

    fs::create_dir_all(&destination).map_err(|e| format!("无法创建 Agent skills 目录: {}", e))?;
    symlink(&skill_path, &link_path).map_err(|e| format!("无法创建软链: {}", e))?;
    let linked = skill_path.join("SKILL.md").is_file();
    update_connection_cache(conn, skill_id, agent_id, linked, &link_path)?;
    Ok(())
}

fn update_connection_cache(
    conn: &Connection,
    skill_id: &str,
    agent_id: &str,
    linked: bool,
    entry_path: &Path,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO connections (skill_id, runtime, linked, symlink_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(skill_id, runtime) DO UPDATE SET
            linked=excluded.linked, symlink_path=excluded.symlink_path,
            updated_at=excluded.updated_at",
        params![
            skill_id,
            agent_id,
            linked as i32,
            entry_path.to_string_lossy().to_string(),
            crate::db::now_iso()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn adopt_real_entry(
    conn: &Connection,
    skill_id: &str,
    agent_id: &str,
    library_source_id: &str,
) -> Result<SkillConnectionState, String> {
    let skill = get_skill(conn, skill_id)?;
    let agents = crate::db::db_enabled_agents(conn);
    let agent = agents
        .iter()
        .find(|agent| agent.id == agent_id)
        .ok_or_else(|| format!("agent not found: {}", agent_id))?;
    let skill_rows = [skill.clone()];
    let probes = all_connection_probes(conn, &skill_rows, &agents);
    let selected: Vec<ConnectionProbe> = probes
        .into_iter()
        .filter(|probe| probe.skill_id == skill_id && probe.agent_id == agent_id)
        .collect();
    let real = selected
        .iter()
        .find(|probe| {
            probe.kind == ConnectionKind::RealDirectory || probe.kind == ConnectionKind::RealFile
        })
        .ok_or_else(|| format!("Agent {} 没有可收纳的真实入口", agent_id))?;
    let real_path = PathBuf::from(&real.entry_path);

    let library_path: String = conn
        .query_row(
            "SELECT path FROM library_sources WHERE id = ?1 AND enabled = 1",
            params![library_source_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("library source not found or disabled: {}", library_source_id))?;
    let library_dir = {
        let base = PathBuf::from(&library_path);
        if base.is_absolute() {
            base
        } else {
            dirs::home_dir().unwrap_or_default().join(base)
        }
    };
    let entry_name = real_path
        .file_name()
        .ok_or_else(|| format!("invalid real entry path: {}", real.entry_path))?;
    let destination = library_dir.join(entry_name);

    if fs::symlink_metadata(&destination).is_ok() {
        return Err(format!(
            "库源目标已存在，拒绝覆盖：{}",
            destination.to_string_lossy()
        ));
    }

    fs::create_dir_all(&library_dir)
        .map_err(|e| format!("无法创建库源目录 {}: {}", library_dir.to_string_lossy(), e))?;
    fs::rename(&real_path, &destination)
        .map_err(|e| format!("无法移动真实入口: {}", e))?;

    if let Err(link_error) = symlink(&destination, &real_path) {
        if let Err(rollback_error) = fs::rename(&destination, &real_path) {
            return Err(format!(
                "无法创建软链: {}；回滚移动失败: {}；已保留库源文件：{}",
                link_error,
                rollback_error,
                destination.to_string_lossy()
            ));
        }
        return Err(format!("无法创建软链: {}", link_error));
    }

    let linked = destination.join("SKILL.md").is_file();
    update_connection_cache(conn, skill_id, agent_id, linked, &real_path)?;
    Ok(SkillConnectionState {
        agent_id: agent.id.clone(),
        agent_label: agent.label.clone(),
        kind: ConnectionKind::Symlink,
        entry_path: real_path.to_string_lossy().to_string(),
        target_path: Some(destination.to_string_lossy().to_string()),
        enabled: destination.join("SKILL.md").is_file(),
        shared: false,
        affected_agents: vec![agent.id.clone()],
    })
}

pub(crate) fn get_skill(conn: &Connection, skill_id: &str) -> Result<SkillRow, String> {
    conn.query_row(
        "SELECT id, name, source_lib, path, description, content_hash, tags, enabled,
                author, license, version, permissions
         FROM skills WHERE id = ?1",
        params![skill_id],
        |row| {
            Ok(SkillRow {
                id: row.get(0)?,
                name: row.get(1)?,
                source_lib: row.get(2)?,
                path: row.get(3)?,
                description: row.get(4)?,
                content_hash: row.get(5)?,
                tags: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                links: Vec::new(),
                enabled: row.get::<_, i64>(7)? != 0,
                author: row.get(8)?,
                license: row.get(9)?,
                version: row.get(10)?,
                permissions: serde_json::from_str(&row.get::<_, String>(11)?).unwrap_or_default(),
            })
        },
    )
    .map_err(|_| "skill not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AgentRow, SkillRow};
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "skill-deck-connections-{}-{}-{}",
                label,
                std::process::id(),
                id
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn skill(path: &std::path::Path, enabled: bool) -> SkillRow {
        SkillRow {
            id: "library:test".into(),
            name: "Test".into(),
            source_lib: "Library".into(),
            path: path.to_string_lossy().to_string(),
            description: String::new(),
            content_hash: String::new(),
            tags: Vec::new(),
            links: Vec::new(),
            enabled,
            author: String::new(),
            license: String::new(),
            version: String::new(),
            permissions: Vec::new(),
        }
    }

    fn agent(skills_dir: &std::path::Path) -> AgentRow {
        AgentRow {
            id: "test-agent".into(),
            label: "Test Agent".into(),
            skills_dir: skills_dir.to_string_lossy().to_string(),
            config_dir: String::new(),
            mcp_config_file: String::new(),
            color: "slate".into(),
            auto_scan: false,
            scan_agents_dir: false,
            enabled: true,
            sort_order: 0,
        }
    }

    #[test]
    fn probes_symlink_real_directory_and_real_file_connections() {
        let root = TempDir::new("kinds");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let real_dir = agent_dir.join("real-dir");
        let real_file = agent_dir.join("real-file");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        fs::create_dir_all(&real_dir).unwrap();
        fs::write(&real_file, "not a skill").unwrap();
        symlink(&library, agent_dir.join("test")).unwrap();

        let probes = probe_agent_entries(
            &agent(&agent_dir),
            &[skill(&library, true), skill(&real_dir, true), skill(&real_file, true)],
        );

        assert_eq!(probes.len(), 3);
        let link = probes.iter().find(|p| p.entry_path.ends_with("/test")).unwrap();
        let real_directory = probes
            .iter()
            .find(|p| p.entry_path.ends_with("/real-dir"))
            .unwrap();
        let real_file = probes
            .iter()
            .find(|p| p.entry_path.ends_with("/real-file"))
            .unwrap();
        assert_eq!(link.kind, ConnectionKind::Symlink);
        assert!(link.enabled);
        assert_eq!(real_directory.kind, ConnectionKind::RealDirectory);
        assert!(!real_directory.enabled);
        assert_eq!(real_file.kind, ConnectionKind::RealFile);
        assert!(!real_file.enabled);
    }

    #[test]
    fn probing_disabled_manifest_reports_disabled_connection() {
        let root = TempDir::new("disabled");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md.disabled"), "disabled skill").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        symlink(&library, agent_dir.join("test")).unwrap();

        let probes = probe_agent_entries(&agent(&agent_dir), &[skill(&library, false)]);

        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].kind, ConnectionKind::Symlink);
        assert!(!probes[0].enabled);
    }

    #[test]
    fn sync_counts_disabled_symlink_as_not_linked() {
        let root = TempDir::new("sync-disabled");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let link = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md.disabled"), "disabled skill").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        symlink(&library, &link).unwrap();

        let conn = connection_test_db();
        let agents = vec![agent(&agent_dir)];
        sync_skill_connections(&conn, &[skill(&library, false)], &agents).unwrap();

        let linked: i64 = conn
            .query_row(
                "SELECT linked FROM connections
                 WHERE skill_id='library:test' AND runtime='test-agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 0);
        assert!(link.symlink_metadata().is_ok());

        fs::rename(library.join("SKILL.md.disabled"), library.join("SKILL.md")).unwrap();
        sync_skill_connections(&conn, &[skill(&library, true)], &agents).unwrap();

        let linked: i64 = conn
            .query_row(
                "SELECT linked FROM connections
                 WHERE skill_id='library:test' AND runtime='test-agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 1);
    }

    fn connection_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, source_lib TEXT NOT NULL,
                path TEXT NOT NULL, description TEXT DEFAULT '', tags TEXT DEFAULT '[]',
                content_hash TEXT DEFAULT '', enabled INTEGER DEFAULT 1,
                author TEXT DEFAULT '', license TEXT DEFAULT '', version TEXT DEFAULT '',
                permissions TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE agents (
                id TEXT PRIMARY KEY, label TEXT NOT NULL, skills_dir TEXT NOT NULL,
                config_dir TEXT NOT NULL, mcp_config_file TEXT NOT NULL,
                color TEXT NOT NULL, auto_scan INTEGER NOT NULL,
                scan_agents_dir INTEGER NOT NULL, enabled INTEGER NOT NULL,
                sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE projects (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
                color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE connections (
                skill_id TEXT NOT NULL, runtime TEXT NOT NULL, linked INTEGER DEFAULT 0,
                symlink_path TEXT, updated_at TEXT NOT NULL,
                PRIMARY KEY (skill_id, runtime)
            );
            CREATE TABLE library_sources (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
                enabled INTEGER NOT NULL, sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn insert_skill(conn: &rusqlite::Connection, path: &std::path::Path) {
        conn.execute(
            "INSERT INTO skills (id, name, source_lib, path, created_at, updated_at)
             VALUES ('library:test', 'Test', 'Library', ?1, 'now', 'now')",
            rusqlite::params![path.to_string_lossy().to_string()],
        )
        .unwrap();
    }

    fn insert_agent(
        conn: &rusqlite::Connection,
        id: &str,
        skills_dir: &std::path::Path,
        scan_agents_dir: bool,
    ) -> AgentRow {
        conn.execute(
            "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color,
                auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
             VALUES (?1, ?1, ?2, '', '', 'slate', 0, ?3, 1, 0, 'now', 'now')",
            rusqlite::params![id, skills_dir.to_string_lossy().to_string(), scan_agents_dir as i32],
        )
        .unwrap();
        AgentRow {
            id: id.into(),
            label: id.into(),
            skills_dir: skills_dir.to_string_lossy().to_string(),
            config_dir: String::new(),
            mcp_config_file: String::new(),
            color: "slate".into(),
            auto_scan: false,
            scan_agents_dir,
            enabled: true,
            sort_order: 0,
        }
    }

    fn insert_skill_agent_rows(conn: &rusqlite::Connection, agents: &[AgentRow]) {
        for agent in agents {
            conn.execute(
                "INSERT OR IGNORE INTO connections (skill_id, runtime, linked, updated_at)
                 VALUES ('library:test', ?1, 0, 'now')",
                rusqlite::params![agent.id],
            )
            .unwrap();
        }
    }

    fn db_agents_for(conn: &rusqlite::Connection) -> Vec<AgentRow> {
        crate::db::db_enabled_agents(conn)
    }

    fn insert_library_source(
        conn: &rusqlite::Connection,
        id: &str,
        path: &std::path::Path,
    ) {
        conn.execute(
            "INSERT INTO library_sources (id, name, path, enabled, sort_order, created_at, updated_at)
             VALUES (?1, ?1, ?2, 1, 0, 'now', 'now')",
            rusqlite::params![id, path.to_string_lossy().to_string()],
        )
        .unwrap();
    }

    #[test]
    fn disconnects_private_symlink() {
        let root = TempDir::new("private-disconnect");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("private-skills");
        let link = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        symlink(&library, &link).unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));

        disconnect_skill_connection(&conn, "library:test", "agent", false).unwrap();

        assert!(!link.symlink_metadata().is_ok());
        let linked: i64 = conn
            .query_row(
                "SELECT linked FROM connections WHERE skill_id='library:test' AND runtime='agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 0);
    }

    #[test]
    fn shared_symlink_requires_confirmation_and_updates_every_affected_agent() {
        let root = TempDir::new("shared-disconnect");
        let library = root.path().join("library").join("test");
        let shared = root.path().join(".agents").join("skills");
        let link = shared.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&shared).unwrap();
        symlink(&library, &link).unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        conn.execute(
            "INSERT INTO projects (id, name, path, color, sort_order, created_at, updated_at)
             VALUES ('project', 'Project', ?1, 'slate', 0, 'now', 'now')",
            rusqlite::params![root.path().to_string_lossy().to_string()],
        )
        .unwrap();
        let first = insert_agent(&conn, "first", &root.path().join("first-skills"), true);
        let second = insert_agent(&conn, "second", &root.path().join("second-skills"), true);
        let private = insert_agent(&conn, "private", &root.path().join("private-skills"), false);
        let agents = vec![first, second, private];
        insert_skill_agent_rows(&conn, &agents);

        let error = disconnect_skill_connection(&conn, "library:test", "first", false)
            .expect_err("shared disconnect must require confirmation");
        assert!(error.contains("second"), "error should name affected agents: {}", error);
        assert!(link.symlink_metadata().is_ok());

        disconnect_skill_connection(&conn, "library:test", "first", true).unwrap();
        assert!(!link.symlink_metadata().is_ok());
        let linked: Vec<i64> = conn
            .prepare("SELECT linked FROM connections WHERE skill_id='library:test' ORDER BY runtime")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(linked, vec![0, 0, 0]);
    }

    #[test]
    fn refuses_to_delete_real_directory_connection() {
        let root = TempDir::new("real-disconnect");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let real = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("SKILL.md"), "real copy").unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));

        let error = disconnect_skill_connection(&conn, "library:test", "agent", true)
            .expect_err("real entries must not be deleted");
        assert!(error.contains("真实目录"), "error should explain real entry: {}", error);
        assert!(real.join("SKILL.md").is_file());
    }

    #[test]
    fn connects_skill_with_private_symlink() {
        let root = TempDir::new("safe-connect");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let link = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));

        connect_skill_connection(&conn, "library:test", "agent").unwrap();

        assert_eq!(fs::read_link(&link).unwrap(), fs::canonicalize(&library).unwrap());
        let linked: i64 = conn
            .query_row(
                "SELECT linked FROM connections WHERE skill_id='library:test' AND runtime='agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 1);
    }

    #[test]
    fn connecting_disabled_skill_keeps_symlink_but_does_not_count_link() {
        let root = TempDir::new("disabled-connect");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let link = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md.disabled"), "disabled skill").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));

        connect_skill_connection(&conn, "library:test", "agent").unwrap();

        assert!(link.symlink_metadata().is_ok());
        let linked: i64 = conn
            .query_row(
                "SELECT linked FROM connections WHERE skill_id='library:test' AND runtime='agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 0);
    }

    #[test]
    fn connecting_refuses_to_replace_real_file() {
        let root = TempDir::new("connect-real-file");
        let library = root.path().join("library").join("test");
        let agent_dir = root.path().join("agent-skills");
        let real = agent_dir.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        fs::write(&real, "do not replace").unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));

        let error = connect_skill_connection(&conn, "library:test", "agent")
            .expect_err("real entries must not be replaced");
        assert!(error.contains("真实文件"), "error should explain real entry: {}", error);
        assert_eq!(fs::read_to_string(&real).unwrap(), "do not replace");
    }

    #[test]
    fn adopts_real_directory_by_moving_it_into_library_source() {
        let root = TempDir::new("adopt-directory");
        let library = root.path().join("library").join("test");
        let library_source = root.path().join("library-source");
        let agent_dir = root.path().join("agent-skills");
        let real = agent_dir.join("test");
        let adopted = library_source.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&library_source).unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("SKILL.md"), "real skill").unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));
        insert_library_source(&conn, "selected", &library_source);

        let state = adopt_real_entry(&conn, "library:test", "agent", "selected").unwrap();

        assert!(real.is_symlink());
        assert_eq!(
            fs::canonicalize(fs::read_link(&real).unwrap()).unwrap(),
            fs::canonicalize(&adopted).unwrap()
        );
        assert_eq!(fs::read_to_string(adopted.join("SKILL.md")).unwrap(), "real skill");
        assert_eq!(state.kind, ConnectionKind::Symlink);
    }

    #[test]
    fn adopts_real_file_by_moving_it_into_library_source() {
        let root = TempDir::new("adopt-file");
        let library = root.path().join("library").join("test");
        let library_source = root.path().join("library-source");
        let agent_dir = root.path().join("agent-skills");
        let real = agent_dir.join("test");
        let adopted = library_source.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&library_source).unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        fs::write(&real, "blocked by real file").unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));
        insert_library_source(&conn, "selected", &library_source);

        let state = adopt_real_entry(&conn, "library:test", "agent", "selected").unwrap();

        assert!(real.is_symlink());
        assert_eq!(fs::read_to_string(&adopted).unwrap(), "blocked by real file");
        assert_eq!(state.kind, ConnectionKind::Symlink);
        assert!(!state.enabled);
    }

    #[test]
    fn adoption_refuses_destination_conflict_without_changing_paths() {
        let root = TempDir::new("adopt-conflict");
        let library = root.path().join("library").join("test");
        let library_source = root.path().join("library-source");
        let agent_dir = root.path().join("agent-skills");
        let real = agent_dir.join("test");
        let conflict = library_source.join("test");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("SKILL.md"), "---\nname: Test\n---\n").unwrap();
        fs::create_dir_all(&library_source).unwrap();
        fs::create_dir_all(&agent_dir).unwrap();
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("SKILL.md"), "real skill").unwrap();
        fs::write(&conflict, "existing destination").unwrap();

        let conn = connection_test_db();
        insert_skill(&conn, &library);
        insert_agent(&conn, "agent", &agent_dir, false);
        insert_skill_agent_rows(&conn, &db_agents_for(&conn));
        insert_library_source(&conn, "selected", &library_source);

        let error = adopt_real_entry(&conn, "library:test", "agent", "selected")
            .expect_err("destination conflict must be rejected");
        assert!(error.contains("已存在"), "error should explain conflict: {}", error);
        assert!(real.join("SKILL.md").is_file());
        assert!(!real.is_symlink());
        assert_eq!(fs::read_to_string(&conflict).unwrap(), "existing destination");
    }
}
