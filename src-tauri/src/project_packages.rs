use crate::db::{
    DbState, PackageConfigInput, PackageInput, PackageMcpInput, PackageRow, PackageSkillInput,
};
use crate::packages::{list_packages, sanitize, save_package};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct ProjectAgentConfig {
    id: String,
    config_dir: String,
    mcp_config_file: String,
}

struct CommonAgentTemplate {
    id: &'static str,
    config_dir: &'static str,
    mcp_config_file: &'static str,
    markers: &'static [&'static str],
}

const COMMON_PROJECT_AGENTS: &[CommonAgentTemplate] = &[
    CommonAgentTemplate {
        id: "claude",
        config_dir: ".claude",
        mcp_config_file: ".claude.json",
        markers: &[".claude", "CLAUDE.md", ".claude.json"],
    },
    CommonAgentTemplate {
        id: "codex",
        config_dir: ".codex",
        mcp_config_file: "config.toml",
        markers: &[".codex", "AGENTS.md"],
    },
    CommonAgentTemplate {
        id: "cursor",
        config_dir: ".cursor",
        mcp_config_file: ".cursor/mcp.json",
        markers: &[".cursor", ".cursorrules"],
    },
    CommonAgentTemplate {
        id: "trae",
        config_dir: ".trae-cn",
        mcp_config_file: "mcp.json",
        markers: &[".trae", ".trae-cn"],
    },
    CommonAgentTemplate {
        id: "workbuddy",
        config_dir: ".workbuddy",
        mcp_config_file: "mcp.json",
        markers: &[".workbuddy"],
    },
    CommonAgentTemplate {
        id: "gemini",
        config_dir: ".gemini",
        mcp_config_file: "settings.json",
        markers: &[".gemini", "GEMINI.md"],
    },
    CommonAgentTemplate {
        id: "windsurf",
        config_dir: ".windsurf",
        mcp_config_file: "mcp.json",
        markers: &[".windsurf", ".windsurfrules"],
    },
    CommonAgentTemplate {
        id: "opencode",
        config_dir: ".opencode",
        mcp_config_file: "opencode.json",
        markers: &[".opencode", "opencode.json"],
    },
];

fn project_agents(conn: &Connection, root: &Path) -> Vec<ProjectAgentConfig> {
    let mut stmt = match conn.prepare(
        "SELECT id, config_dir, mcp_config_file FROM agents
         WHERE enabled = 1 ORDER BY sort_order, id",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    let mut agents: Vec<ProjectAgentConfig> = stmt
        .query_map([], |row| {
            Ok(ProjectAgentConfig {
                id: row.get(0)?,
                config_dir: row.get(1)?,
                mcp_config_file: row.get(2)?,
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    for template in COMMON_PROJECT_AGENTS {
        if agents.iter().any(|agent| agent.id == template.id) {
            continue;
        }
        if template
            .markers
            .iter()
            .any(|marker| root.join(marker).exists())
        {
            agents.push(ProjectAgentConfig {
                id: template.id.to_string(),
                config_dir: template.config_dir.to_string(),
                mcp_config_file: template.mcp_config_file.to_string(),
            });
        }
    }

    agents
}

fn project_relative(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn rule_files_for_agent(agent_id: &str) -> &'static [&'static str] {
    match agent_id {
        "claude" => &["CLAUDE.md"],
        "codex" => &["AGENTS.md"],
        "cursor" => &[".cursorrules"],
        "gemini" => &["GEMINI.md"],
        "windsurf" => &[".windsurfrules"],
        "trae" => &[".trae/rules/project_rules.md"],
        _ => &["CLAUDE.md", "AGENTS.md"],
    }
}

fn push_project_rule(
    output: &mut Vec<PackageConfigInput>,
    seen: &mut HashSet<String>,
    agent: &str,
    file_name: &str,
    content: String,
) {
    if agent.is_empty() || file_name.is_empty() || content.is_empty() {
        return;
    }
    let key = format!("{}\u{0}{}", agent, file_name);
    if seen.insert(key) {
        output.push(PackageConfigInput {
            agent: agent.to_string(),
            category: "rules".to_string(),
            file_name: file_name.to_string(),
            content,
        });
    }
}

fn project_rule_inputs(
    conn: &Connection,
    root: &Path,
    agents: &[ProjectAgentConfig],
) -> Vec<PackageConfigInput> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();

    for agent in agents {
        let config_dir = project_relative(root, &agent.config_dir);
        for file_name in rule_files_for_agent(&agent.id) {
            for path in [root.join(file_name), config_dir.join(file_name)] {
                if let Ok(content) = fs::read_to_string(path) {
                    push_project_rule(&mut output, &mut seen, &agent.id, file_name, content);
                    break;
                }
            }
        }
    }

    if let Ok(mut stmt) = conn
        .prepare("SELECT content, platform, target_path FROM rules WHERE target_path IS NOT NULL")
    {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        });
        if let Ok(rows) = rows {
            for (content, platform, target_path) in rows.flatten() {
                let path = PathBuf::from(&target_path);
                if !path.starts_with(root) {
                    continue;
                }
                let file_name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                let agent = if agents.iter().any(|item| item.id == platform) {
                    platform
                } else if file_name == "AGENTS.md" {
                    "codex".to_string()
                } else {
                    agents
                        .first()
                        .map(|item| item.id.clone())
                        .unwrap_or_default()
                };
                push_project_rule(&mut output, &mut seen, &agent, &file_name, content);
            }
        }
    }

    output
}

fn push_json_mcp_entries(
    path: &Path,
    output: &mut Vec<PackageMcpInput>,
    seen: &mut HashSet<String>,
) {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return,
    };
    let root: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return,
    };
    let Some(servers) = root.get("mcpServers").and_then(|value| value.as_object()) else {
        return;
    };
    for (name, config) in servers {
        if config.get("enabled").and_then(|value| value.as_bool()) == Some(false) {
            continue;
        }
        if seen.insert(name.clone()) {
            output.push(PackageMcpInput {
                name: name.clone(),
                config_json: config.to_string(),
            });
        }
    }
}

fn push_toml_mcp_entries(
    path: &Path,
    output: &mut Vec<PackageMcpInput>,
    seen: &mut HashSet<String>,
) {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return,
    };
    let Ok(value) = toml::from_str::<toml::Value>(&raw) else {
        return;
    };
    let Some(servers) = value.get("mcp_servers").and_then(|value| value.as_table()) else {
        return;
    };
    for (name, config) in servers {
        if config.get("enabled").and_then(|value| value.as_bool()) == Some(false) {
            continue;
        }
        if let Ok(config_json) = serde_json::to_string(config) {
            if seen.insert(name.clone()) {
                output.push(PackageMcpInput {
                    name: name.clone(),
                    config_json,
                });
            }
        }
    }
}

fn project_mcp_inputs(root: &Path, agents: &[ProjectAgentConfig]) -> Vec<PackageMcpInput> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    let mut json_paths = vec![
        root.join(".mcp.json"),
        root.join(".claude.json"),
        root.join(".cursor").join("mcp.json"),
    ];
    let mut toml_paths = Vec::new();

    for agent in agents {
        if agent.mcp_config_file.is_empty() {
            continue;
        }
        let config_path = project_relative(root, &agent.mcp_config_file);
        let nested_path = project_relative(root, &agent.config_dir).join(&agent.mcp_config_file);
        if agent.mcp_config_file.ends_with(".toml") {
            toml_paths.push(config_path);
            toml_paths.push(nested_path);
        } else {
            json_paths.push(config_path);
            json_paths.push(nested_path);
        }
    }

    for path in json_paths {
        push_json_mcp_entries(&path, &mut output, &mut seen);
    }
    for path in toml_paths {
        push_toml_mcp_entries(&path, &mut output, &mut seen);
    }
    output
}

fn project_skill_inputs(conn: &Connection, project_id: &str) -> Vec<PackageSkillInput> {
    let prefix = format!("project:{}:%", project_id);
    let mut stmt = match conn
        .prepare("SELECT id, name, path FROM skills WHERE id LIKE ?1 AND enabled = 1 ORDER BY name")
    {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![prefix], |row| {
        Ok(PackageSkillInput {
            name: row.get(1)?,
            skill_id: Some(row.get(0)?),
            source_path: row.get(2)?,
        })
    });
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    if let Ok(rows) = rows {
        for skill in rows.flatten() {
            if seen.insert(skill.name.clone()) {
                output.push(skill);
            }
        }
    }
    output
}

pub fn create_package_from_project(
    conn: &Connection,
    project_id: &str,
) -> Result<PackageRow, String> {
    let (project_name, project_path): (String, String) = conn
        .query_row(
            "SELECT name, path FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("project not found: {}", project_id))?;
    let root = PathBuf::from(&project_path);
    if !root.is_dir() {
        return Err(format!("不是有效项目目录: {}", project_path));
    }

    let agents = project_agents(conn, &root);
    let package_name = {
        let name = sanitize(&format!("project-{}", project_id));
        if name.is_empty() {
            format!("project-{}", Uuid::new_v4())
        } else {
            name
        }
    };
    let input = PackageInput {
        name: package_name.clone(),
        display_name: Some(project_name.clone()),
        version: Some("0.1.0".to_string()),
        description: Some(format!("从项目「{}」生成", project_name)),
        skills: project_skill_inputs(conn, project_id),
        mcps: project_mcp_inputs(&root, &agents),
        configs: project_rule_inputs(conn, &root, &agents),
    };
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM packages WHERE name = ?1",
            params![package_name],
            |row| row.get(0),
        )
        .ok();
    let id = save_package(conn, &input, existing_id.as_deref())?;
    list_packages(conn)
        .into_iter()
        .find(|package| package.id == id)
        .ok_or_else(|| "created preset not found".to_string())
}

#[tauri::command]
pub fn create_pkg_from_project(
    db: State<DbState>,
    project_id: String,
) -> Result<PackageRow, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    create_package_from_project(&conn, &project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "skill-deck-project-package-{}-{}-{}",
                label,
                std::process::id(),
                id
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE packages (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '0.1.0',
                description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE package_skills (
                package_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL, skill_id TEXT, source_path TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (package_id, name)
            );
            CREATE TABLE package_mcps (
                package_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (package_id, name)
            );
            CREATE TABLE package_configs (
                package_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
                agent TEXT NOT NULL, category TEXT NOT NULL, file_name TEXT NOT NULL,
                content TEXT NOT NULL, PRIMARY KEY (package_id, agent, file_name)
            );
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
            CREATE TABLE rules (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                platform TEXT DEFAULT 'claude', target_path TEXT, tags TEXT DEFAULT '[]',
                source TEXT DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE activity_log (
                id INTEGER PRIMARY KEY, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
            );
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn creates_and_updates_one_preset_from_project_content() {
        let root = TempDir::new("project-package");
        let conn = test_db();
        conn.execute(
            "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color,
                auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
             VALUES ('claude', 'Claude', '.claude/skills', '.claude', '.claude.json', 'orange',
                0, 0, 1, 0, 'now', 'now'),
             ('codex', 'Codex', '.codex/skills', '.codex', 'config.toml', 'green',
                0, 1, 1, 1, 'now', 'now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, path, color, sort_order, created_at, updated_at)
             VALUES ('demo', 'Demo', ?1, 'slate', 0, 'now', 'now')",
            params![root.path().to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, source_lib, path, enabled, created_at, updated_at)
             VALUES ('project:demo:alpha', 'alpha', 'Demo', ?1, 1, 'now', 'now'),
                    ('project:demo:disabled', 'disabled', 'Demo', ?2, 0, 'now', 'now')",
            params![
                root.path().join("alpha").to_string_lossy().to_string(),
                root.path().join("disabled").to_string_lossy().to_string(),
            ],
        )
        .unwrap();

        fs::write(root.path().join("CLAUDE.md"), "# Claude rules").unwrap();
        fs::write(
            root.path().join(".claude.json"),
            r#"{"mcpServers":{"search":{"command":"search-server"}}}"#,
        )
        .unwrap();
        fs::create_dir_all(root.path().join(".codex")).unwrap();
        fs::write(
            root.path().join(".codex").join("config.toml"),
            "[mcp_servers.context]\ncommand = \"context-server\"\n",
        )
        .unwrap();
        let custom_rule = root.path().join(".codex").join("AGENTS.md");
        fs::write(&custom_rule, "# Agent rules").unwrap();
        conn.execute(
            "INSERT INTO rules (title, content, platform, target_path, created_at, updated_at)
             VALUES ('Custom', ?1, 'codex', ?2, 'now', 'now')",
            params!["# Custom rules", custom_rule.to_string_lossy().to_string()],
        )
        .unwrap();

        let preset = create_package_from_project(&conn, "demo").unwrap();
        assert_eq!(preset.name, "project-demo");
        assert_eq!(preset.skill_count, 1);
        assert_eq!(preset.mcp_count, 2);
        assert_eq!(preset.config_count, 2);

        conn.execute(
            "INSERT INTO skills (id, name, source_lib, path, enabled, created_at, updated_at)
             VALUES ('project:demo:beta', 'beta', 'Demo', ?1, 1, 'now', 'now')",
            params![root.path().join("beta").to_string_lossy().to_string()],
        )
        .unwrap();
        let updated = create_package_from_project(&conn, "demo").unwrap();
        let package_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM packages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(package_count, 1);
        assert_eq!(updated.id, preset.id);
        assert_eq!(updated.skill_count, 2);
    }

    #[test]
    fn detects_common_agents_from_project_markers() {
        let root = TempDir::new("project-agent-detection");
        let conn = test_db();
        conn.execute(
            "INSERT INTO projects (id, name, path, color, sort_order, created_at, updated_at)
             VALUES ('cursor-demo', 'Cursor Demo', ?1, 'slate', 0, 'now', 'now')",
            params![root.path().to_string_lossy().to_string()],
        )
        .unwrap();

        fs::write(root.path().join(".cursorrules"), "# Cursor rules").unwrap();
        fs::create_dir_all(root.path().join(".cursor")).unwrap();
        fs::write(
            root.path().join(".cursor").join("mcp.json"),
            r#"{"mcpServers":{"context":{"command":"context-server"}}}"#,
        )
        .unwrap();

        let preset = create_package_from_project(&conn, "cursor-demo").unwrap();
        assert_eq!(preset.mcp_count, 1);
        assert_eq!(preset.config_count, 1);

        let (agent, file_name): (String, String) = conn
            .query_row("SELECT agent, file_name FROM package_configs", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(agent, "cursor");
        assert_eq!(file_name, ".cursorrules");
    }
}
