use crate::db::{db_enabled_agents, AgentRow};
use rusqlite::Connection;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpConfigFormat {
    /// Claude's user config is a JSON object with a top-level `mcpServers` map.
    ClaudeJson,
    /// Codex's user config is TOML with a top-level `mcp_servers` table.
    CodexToml,
    /// Other agents use the common JSON shape: `{ "mcpServers": {} }`.
    JsonServers,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpTarget {
    pub path: String,
    pub format: McpConfigFormat,
}

fn join_home(home: &Path, configured: &str) -> PathBuf {
    let configured = PathBuf::from(configured);
    if configured.is_absolute() {
        configured
    } else {
        home.join(configured)
    }
}

pub fn agent_by_id(conn: &Connection, id: &str) -> Result<AgentRow, String> {
    db_enabled_agents(conn)
        .into_iter()
        .find(|agent| agent.id == id)
        .ok_or_else(|| format!("agent not found or disabled: {}", id))
}

/// Resolve the real MCP configuration used by the Extension and Package features.
///
/// Claude and Codex have established config locations and formats; their registry
/// rows are intentionally overridden here so Package apply and Extension scan can
/// never drift apart again. Custom agents follow their configured config dir/file.
pub fn mcp_target_for_agent(agent: &AgentRow, home: &Path) -> Result<McpTarget, String> {
    let (path, format) = match agent.id.as_str() {
        "claude" => (home.join(".claude.json"), McpConfigFormat::ClaudeJson),
        "codex" => (
            home.join(".codex").join("config.toml"),
            McpConfigFormat::CodexToml,
        ),
        _ => {
            if agent.mcp_config_file.trim().is_empty() {
                return Err(format!("agent {} 没有配置 MCP 配置文件", agent.id));
            }
            let configured = PathBuf::from(&agent.mcp_config_file);
            let path = if configured.is_absolute() {
                configured
            } else {
                join_home(home, &agent.config_dir).join(configured)
            };
            let format = if path.extension().and_then(|value| value.to_str())
                == Some("toml")
            {
                McpConfigFormat::CodexToml
            } else {
                McpConfigFormat::JsonServers
            };
            (path, format)
        }
    };
    Ok(McpTarget {
        path: path.to_string_lossy().to_string(),
        format,
    })
}

pub fn mcp_target(conn: &Connection, agent_id: &str) -> Result<McpTarget, String> {
    let home = dirs::home_dir().ok_or("无法确定用户主目录")?;
    mcp_target_for_agent(&agent_by_id(conn, agent_id)?, &home)
}

/// Ensure the target is a single file directly under `root`, and never follow or
/// replace a symlink. Package rule/config file names are intentionally limited to
/// a basename; allowing nested paths turns the manifest into a path-traversal API.
pub fn safe_config_target(root: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.trim().is_empty() {
        return Err("配置文件名不能为空".to_string());
    }
    let relative = PathBuf::from(file_name);
    let mut components = relative.components();
    let invalid = match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(name)), None) => {
            name.to_string_lossy() != file_name
        }
        _ => true,
    };
    if invalid {
        return Err(format!("非法配置文件名: {}", file_name));
    }

    let target = root.join(file_name);
    if fs::symlink_metadata(&target)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("配置目标是软链，拒绝覆盖: {}", target.to_string_lossy()));
    }
    Ok(target)
}

pub fn global_config_target(
    conn: &Connection,
    agent_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let agent = agent_by_id(conn, agent_id)?;
    let home = dirs::home_dir().ok_or("无法确定用户主目录")?;
    let config_dir = join_home(&home, &agent.config_dir);
    safe_config_target(&config_dir, file_name)
}

fn read_optional(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn json_root(raw: Option<String>) -> Result<serde_json::Value, String> {
    match raw {
        None => Ok(serde_json::json!({ "mcpServers": {} })),
        Some(raw) if raw.trim().is_empty() => Ok(serde_json::json!({ "mcpServers": {} })),
        Some(raw) => serde_json::from_str(&raw).map_err(|error| format!("配置不是有效 JSON: {}", error)),
    }
}

fn toml_root(raw: Option<String>) -> Result<toml::Value, String> {
    let raw = raw.unwrap_or_default();
    if raw.trim().is_empty() {
        return Ok(toml::Value::Table(toml::value::Table::new()));
    }
    toml::from_str(&raw).map_err(|error| format!("配置不是有效 TOML: {}", error))
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let output = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    atomic_write(path, output.as_bytes())
}

fn write_toml_atomic(path: &Path, value: &toml::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let output = toml::to_string_pretty(value).map_err(|error| error.to_string())?;
    atomic_write(path, output.as_bytes())
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("目标是软链，拒绝写入: {}", path.to_string_lossy()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("配置路径没有父目录: {}", path.to_string_lossy()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let temp = parent.join(format!(
        ".{}.skilldeck-{}",
        file_name,
        Uuid::new_v4()
    ));
    {
        let mut file = fs::File::create(&temp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })
}

fn json_servers(value: &serde_json::Value) -> Result<&serde_json::Map<String, serde_json::Value>, String> {
    value
        .get("mcpServers")
        .and_then(|servers| servers.as_object())
        .ok_or_else(|| "配置缺少 mcpServers 对象".to_string())
}

fn json_servers_mut(
    value: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>, String> {
    let root = value
        .as_object_mut()
        .ok_or("MCP JSON 根必须是对象")?;
    root.entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    root.get_mut("mcpServers")
        .and_then(|servers| servers.as_object_mut())
        .ok_or_else(|| "mcpServers 必须是对象".to_string())
}

fn toml_servers_mut(
    value: &mut toml::Value,
) -> Result<&mut toml::value::Table, String> {
    let root = value
        .as_table_mut()
        .ok_or("Codex MCP 配置根必须是 TOML table")?;
    root.entry("mcp_servers")
        .or_insert_with(|| toml::Value::Table(toml::value::Table::new()));
    root.get_mut("mcp_servers")
        .and_then(|servers| servers.as_table_mut())
        .ok_or_else(|| "mcp_servers 必须是 TOML table".to_string())
}

/// Read all discovered entries in a normalized JSON string form.
pub fn read_mcp_entries(target: &McpTarget) -> Result<Vec<(String, String)>, String> {
    let path = PathBuf::from(&target.path);
    let raw = read_optional(&path);
    match target.format {
        McpConfigFormat::ClaudeJson | McpConfigFormat::JsonServers => {
            let root = json_root(raw)?;
            Ok(json_servers(&root)?
                .iter()
                .map(|(name, config)| (name.clone(), config.to_string()))
                .collect())
        }
        McpConfigFormat::CodexToml => {
            let root = toml_root(raw)?;
            let Some(servers) = root.get("mcp_servers").and_then(|value| value.as_table()) else {
                return Ok(Vec::new());
            };
            Ok(servers
                .iter()
                .filter(|(_, config)| config.is_table())
                .map(|(name, config)| {
                    let json = serde_json::to_value(config)
                        .map_err(|error| error.to_string())?;
                    Ok((name.clone(), json.to_string()))
                })
                .collect::<Result<Vec<_>, String>>()?)
        }
    }
}

fn upsert_json(
    path: &Path,
    format: McpConfigFormat,
    name: &str,
    config: &serde_json::Value,
    old_name: Option<&str>,
    remove: bool,
) -> Result<(), String> {
    let _ = format;
    let mut root = json_root(read_optional(path))?;
    let servers = json_servers_mut(&mut root)?;
    if let Some(old_name) = old_name {
        servers.remove(old_name);
    }
    if remove {
        servers.remove(name);
    } else {
        servers.insert(name.to_string(), config.clone());
    }
    write_json_atomic(path, &root)
}

fn upsert_toml(
    path: &Path,
    name: &str,
    config: &serde_json::Value,
    old_name: Option<&str>,
    remove: bool,
) -> Result<(), String> {
    let mut root = toml_root(read_optional(path))?;
    let servers = toml_servers_mut(&mut root)?;
    if let Some(old_name) = old_name {
        servers.remove(old_name);
    }
    if remove {
        servers.remove(name);
    } else {
        let server = crate::extensions::json_to_toml(config)?;
        let server = server
            .as_table()
            .cloned()
            .ok_or("MCP server 配置必须是 JSON 对象")?;
        servers.insert(name.to_string(), toml::Value::Table(server));
    }
    write_toml_atomic(path, &root)
}

pub fn upsert_mcp_entry(
    target: &McpTarget,
    name: &str,
    config_json: &str,
    old_name: Option<&str>,
    remove: bool,
) -> Result<(), String> {
    let path = PathBuf::from(&target.path);
    if fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("MCP 配置是软链，拒绝写入: {}", path.to_string_lossy()));
    }
    let config: serde_json::Value = if remove {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        let value: serde_json::Value =
            serde_json::from_str(config_json).map_err(|error| error.to_string())?;
        if !value.is_object() {
            return Err("MCP server 配置必须是 JSON 对象".to_string());
        }
        value
    };
    match target.format {
        McpConfigFormat::ClaudeJson | McpConfigFormat::JsonServers => {
            upsert_json(&path, target.format, name, &config, old_name, remove)
        }
        McpConfigFormat::CodexToml => upsert_toml(&path, name, &config, old_name, remove),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn agent(id: &str, config_dir: &str, mcp_file: &str) -> AgentRow {
        AgentRow {
            id: id.to_string(),
            label: id.to_string(),
            skills_dir: format!(".{}/skills", id),
            config_dir: config_dir.to_string(),
            mcp_config_file: mcp_file.to_string(),
            color: "slate".to_string(),
            auto_scan: false,
            scan_agents_dir: false,
            enabled: true,
            sort_order: 0,
        }
    }

    #[test]
    fn claude_and_codex_use_canonical_mcp_targets() {
        let home = Path::new("/tmp/home");
        let claude = mcp_target_for_agent(&agent("claude", ".claude", ".claude.json"), home).unwrap();
        let codex = mcp_target_for_agent(&agent("codex", ".codex", "config.toml"), home).unwrap();
        assert_eq!(claude.path, "/tmp/home/.claude.json");
        assert_eq!(claude.format, McpConfigFormat::ClaudeJson);
        assert_eq!(codex.path, "/tmp/home/.codex/config.toml");
        assert_eq!(codex.format, McpConfigFormat::CodexToml);
    }

    #[test]
    fn custom_mcp_target_follows_registry() {
        let home = Path::new("/tmp/home");
        let target =
            mcp_target_for_agent(&agent("cursor", ".cursor", "mcp.json"), home).unwrap();
        assert_eq!(target.path, "/tmp/home/.cursor/mcp.json");
        assert_eq!(target.format, McpConfigFormat::JsonServers);
    }

    #[test]
    fn upsert_preserves_unknown_json_fields_and_creates_missing_config() {
        let root = std::env::temp_dir().join(format!(
            "skilldeck-agent-config-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude.json");
        fs::write(
            &path,
            r#"{"unknown":{"keep":true},"mcpServers":{"old":{"command":"old"}}}"#,
        )
        .unwrap();
        let target = McpTarget {
            path: path.to_string_lossy().to_string(),
            format: McpConfigFormat::ClaudeJson,
        };
        upsert_mcp_entry(&target, "new", r#"{"command":"new"}"#, Some("old"), false).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["unknown"]["keep"], serde_json::Value::Bool(true));
        assert!(value["mcpServers"].get("old").is_none());
        assert_eq!(value["mcpServers"]["new"]["command"], "new");

        let missing = McpTarget {
            path: root.join("missing.json").to_string_lossy().to_string(),
            format: McpConfigFormat::JsonServers,
        };
        upsert_mcp_entry(&missing, "fetch", r#"{"command":"fetch"}"#, None, false).unwrap();
        let created = read_mcp_entries(&missing).unwrap();
        let expected: HashMap<_, _> = [("fetch".to_string(), r#"{"command":"fetch"}"#.to_string())]
            .into_iter()
            .collect();
        assert_eq!(created.len(), 1);
        assert_eq!(expected.get("fetch"), Some(&created[0].1));

        let invalid_path = root.join("invalid.json");
        fs::write(&invalid_path, "{invalid").unwrap();
        let invalid = McpTarget {
            path: invalid_path.to_string_lossy().to_string(),
            format: McpConfigFormat::JsonServers,
        };
        assert!(upsert_mcp_entry(&invalid, "fetch", "{}", None, false).is_err());
        assert_eq!(fs::read_to_string(invalid_path).unwrap(), "{invalid");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn safe_config_target_rejects_traversal_and_symlink() {
        let root = std::env::temp_dir().join(format!(
            "skilldeck-agent-config-safe-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        assert!(safe_config_target(&root, "CLAUDE.md").is_ok());
        assert!(safe_config_target(&root, "../CLAUDE.md").is_err());
        assert!(safe_config_target(&root, "nested/CLAUDE.md").is_err());

        let link = root.join("CLAUDE.md");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/tmp/outside.md", &link).unwrap();
        #[cfg(not(unix))]
        fs::write(&link, "file").unwrap();
        assert!(safe_config_target(&root, "CLAUDE.md").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
