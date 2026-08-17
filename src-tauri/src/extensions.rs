use crate::db::{
    now_iso, log_activity, DbState, ExtensionRow, HookInput, McpServerInput, PluginToggleInput,
};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::State;

// ============ paths ============

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn claude_json_path() -> PathBuf {
    home().join(".claude.json")
}

fn claude_settings_path() -> PathBuf {
    home().join(".claude").join("settings.json")
}

fn codex_config_path() -> PathBuf {
    home().join(".codex").join("config.toml")
}

fn codex_plugins_cache() -> PathBuf {
    home().join(".codex").join("plugins").join("cache")
}

fn short_hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize()).chars().take(8).collect()
}

/// 返回某种 kind + runtime 对应的配置文件绝对路径（用于"在访达中打开"）
pub fn config_file_path(kind: &str, runtime: &str) -> String {
    match (kind, runtime) {
        ("mcp", "claude") => claude_json_path().to_string_lossy().to_string(),
        ("mcp", "codex") => codex_config_path().to_string_lossy().to_string(),
        ("hook", _) => claude_settings_path().to_string_lossy().to_string(),
        ("plugin", _) => codex_config_path().to_string_lossy().to_string(),
        _ => String::new(),
    }
}

// ============ read JSON helpers ============

fn read_json(path: &PathBuf) -> serde_json::Value {
    let raw = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
}

fn write_json(path: &PathBuf, v: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let out = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())
}

// ============ scan ============

pub struct DiscoveredExt {
    pub id: String,
    pub kind: String,
    pub runtime: String,
    pub name: String,
    pub config_json: String,
    pub enabled: bool,
    pub description: String,
}

/// Scan all config sources, reconcile DB, return all rows.
pub fn scan_extensions(conn: &Connection) -> Vec<ExtensionRow> {
    let mut found: Vec<DiscoveredExt> = Vec::new();

    // Claude MCP — ~/.claude.json mcpServers
    let cj = read_json(&claude_json_path());
    if let Some(servers) = cj.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, cfg) in servers {
            let id = format!("mcp:claude:{}", name);
            let cmd = cfg.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let desc = format!("{}", cmd);
            found.push(DiscoveredExt {
                id,
                kind: "mcp".into(),
                runtime: "claude".into(),
                name: name.clone(),
                config_json: cfg.to_string(),
                enabled: true,
                description: desc,
            });
        }
    }

    // Claude Hooks — ~/.claude/settings.json hooks
    let cs = read_json(&claude_settings_path());
    if let Some(hooks) = cs.get("hooks").and_then(|v| v.as_object()) {
        for (event, entries) in hooks {
            if let Some(arr) = entries.as_array() {
                for entry in arr {
                    let matcher = entry
                        .get("matcher")
                        .and_then(|v| v.as_str())
                        .unwrap_or("*");
                    if let Some(hook_list) = entry.get("hooks").and_then(|v| v.as_array()) {
                        for h in hook_list {
                            let command = h.get("command").and_then(|v| v.as_str()).unwrap_or("");
                            let timeout = h.get("timeout").and_then(|v| v.as_i64()).unwrap_or(10);
                            let id = format!("hook:claude:{}:{}", event, short_hash(command));
                            let cfg = serde_json::json!({
                                "matcher": matcher,
                                "command": command,
                                "timeout": timeout,
                            });
                            found.push(DiscoveredExt {
                                id,
                                kind: "hook".into(),
                                runtime: "claude".into(),
                                name: event.clone(),
                                config_json: cfg.to_string(),
                                enabled: true,
                                description: command.chars().take(80).collect(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Codex MCP + Plugins — config.toml
    let toml_raw = fs::read_to_string(&codex_config_path()).unwrap_or_default();
    if let Ok(toml_val) = toml::from_str::<toml::Value>(&toml_raw) {
        // Codex MCP
        if let Some(mcp_servers) = toml_val.get("mcp_servers").and_then(|v| v.as_table()) {
            for (name, cfg) in mcp_servers {
                // skip sub-tables like node_repl.env which are nested — only top-level server tables
                if !cfg.is_table() {
                    continue;
                }
                let enabled = cfg
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let cmd = cfg.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let id = format!("mcp:codex:{}", name);
                found.push(DiscoveredExt {
                    id,
                    kind: "mcp".into(),
                    runtime: "codex".into(),
                    name: name.clone(),
                    config_json: to_table_json(cfg),
                    enabled,
                    description: cmd.to_string(),
                });
            }
        }

        // Codex Plugins (configured)
        if let Some(plugins) = toml_val.get("plugins").and_then(|v| v.as_table()) {
            for (name, cfg) in plugins {
                let enabled = cfg
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let id = format!("plugin:codex:{}", name);
                let parts: Vec<&str> = name.splitn(2, '@').collect();
                let display = parts.get(0).copied().unwrap_or("").to_string();
                let marketplace = parts.get(1).copied().unwrap_or("").to_string();
                found.push(DiscoveredExt {
                    id,
                    kind: "plugin".into(),
                    runtime: "codex".into(),
                    name: display,
                    config_json: serde_json::json!({
                        "full_name": name,
                        "marketplace": marketplace,
                        "enabled": enabled,
                    })
                    .to_string(),
                    enabled,
                    description: marketplace.clone(),
                });
            }
        }
    }

    // Codex Plugins (available in cache but not configured) — scan cache dirs
    scan_codex_plugin_cache(&mut found);

    // Reconcile DB: upsert found, track found ids
    let found_ids: std::collections::HashSet<String> =
        found.iter().map(|e| e.id.clone()).collect();

    for e in &found {
        conn.execute(
            "INSERT INTO extensions (id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'scan',?8,?8)
             ON CONFLICT(id) DO UPDATE SET
               config_json=excluded.config_json, enabled=excluded.enabled,
               description=excluded.description, updated_at=excluded.updated_at",
            params![e.id, e.kind, e.runtime, e.name, e.config_json, e.enabled as i32, e.description, now_iso()],
        )
        .ok();
    }

    // Remove scanned rows no longer present (keep manual ones)
    let stale: Vec<String> = {
        let mut stmt = match conn.prepare("SELECT id FROM extensions WHERE source='scan'") {
            Ok(s) => s,
            Err(_) => return get_extensions(conn),
        };
        stmt.query_map([], |row| row.get::<_, String>(0))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).filter(|id| !found_ids.contains(id)).collect())
            .unwrap_or_default()
    };
    for id in &stale {
        conn.execute("DELETE FROM extensions WHERE id=?1", params![id]).ok();
    }

    log_activity(conn, "ext_scan", &format!("{} extensions", found.len()));
    get_extensions(conn)
}

/// Walk ~/.codex/plugins/cache/<marketplace>/<name>/<version>/.codex-plugin/plugin.json
/// 按数值比较点分版本号（如 0.10.0 > 0.9.0），不能依赖字符串字典序
fn is_newer_version(candidate: &str, current: &str) -> bool {
    if current.is_empty() {
        return true;
    }
    let segments = |s: &str| -> Vec<u64> {
        s.split(|c: char| c == '.' || c == '-' || c == '+')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let a = segments(candidate);
    let b = segments(current);
    let len = a.len().max(b.len());
    for i in 0..len {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

fn scan_codex_plugin_cache(found: &mut Vec<DiscoveredExt>) {
    let cache = codex_plugins_cache();
    let entries = match fs::read_dir(&cache) {
        Ok(e) => e,
        Err(_) => return,
    };
    for market_entry in entries.flatten() {
        let market_name = market_entry.file_name().to_string_lossy().to_string();
        let market_dir = market_entry.path();
        if !market_dir.is_dir() {
            continue;
        }
        let plugin_entries = match fs::read_dir(&market_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for pe in plugin_entries.flatten() {
            let plugin_name = pe.file_name().to_string_lossy().to_string();
            let plugin_dir = pe.path();
            // find version dirs
            let version_dirs = match fs::read_dir(&plugin_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            let mut latest_version = String::new();
            let mut latest_manifest: Option<serde_json::Value> = None;
            for vd in version_dirs.flatten() {
                let version_name = vd.file_name().to_string_lossy().to_string();
                let manifest_path = vd.path().join(".codex-plugin").join("plugin.json");
                if let Ok(manifest_raw) = fs::read_to_string(&manifest_path) {
                    if let Ok(m) = serde_json::from_str::<serde_json::Value>(&manifest_raw) {
                        if is_newer_version(&version_name, &latest_version) {
                            latest_version = version_name;
                            latest_manifest = Some(m);
                        }
                    }
                }
            }
            if let Some(m) = latest_manifest {
                let full_name = format!("{}@{}", plugin_name, market_name);
                let id = format!("plugin:codex:{}", full_name);
                // skip if already discovered from config.toml (configured plugins take precedence)
                if found.iter().any(|e| e.id == id) {
                    continue;
                }
                let desc = m
                    .get("interface")
                    .and_then(|i| i.get("shortDescription"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let display = m
                    .get("interface")
                    .and_then(|i| i.get("displayName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&plugin_name)
                    .to_string();
                found.push(DiscoveredExt {
                    id,
                    kind: "plugin".into(),
                    runtime: "codex".into(),
                    name: display,
                    config_json: serde_json::json!({
                        "full_name": full_name,
                        "marketplace": market_name,
                        "version": latest_version,
                        "enabled": false,
                    })
                    .to_string(),
                    enabled: false, // available but not configured
                    description: desc,
                });
            }
        }
    }
}

/// Convert a toml::Value (table) to JSON string
fn to_table_json(v: &toml::Value) -> String {
    // Serialize the toml value to JSON via intermediate
    let json_val = toml_to_json(v);
    serde_json::to_string(&json_val).unwrap_or_else(|_| "{}".into())
}

fn toml_to_json(v: &toml::Value) -> serde_json::Value {
    match v {
        toml::Value::String(s) => serde_json::json!(s),
        toml::Value::Integer(i) => serde_json::json!(i),
        toml::Value::Float(f) => serde_json::json!(f),
        toml::Value::Boolean(b) => serde_json::json!(b),
        toml::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(toml_to_json).collect())
        }
        toml::Value::Table(t) => {
            let mut map = serde_json::Map::new();
            for (k, v) in t {
                map.insert(k.clone(), toml_to_json(v));
            }
            serde_json::Value::Object(map)
        }
        toml::Value::Datetime(d) => serde_json::json!(d.to_string()),
    }
}

pub fn get_extensions(conn: &Connection) -> Vec<ExtensionRow> {
    let mut stmt = match conn.prepare(
        "SELECT id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at
         FROM extensions ORDER BY kind, name COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| {
        Ok(ExtensionRow {
            id: row.get(0)?,
            kind: row.get(1)?,
            runtime: row.get(2)?,
            name: row.get(3)?,
            config_json: row.get(4)?,
            enabled: row.get::<_, i64>(5)? != 0,
            description: row.get(6)?,
            source: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ============ toggle ============

pub fn toggle_extension(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    let row: (String, String, String, String) = conn
        .query_row(
            "SELECT kind, runtime, name, config_json FROM extensions WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "extension not found".to_string())?;
    let (kind, runtime, name, config_json) = row;

    match (kind.as_str(), runtime.as_str()) {
        ("mcp", "claude") => toggle_claude_mcp(&name, &config_json, enabled)?,
        ("mcp", "codex") => toggle_codex_mcp(&name, enabled)?,
        ("hook", "claude") => toggle_claude_hook(&name, &config_json, enabled)?,
        ("plugin", "codex") => toggle_codex_plugin(&config_json, enabled)?,
        _ => return Err(format!("unsupported: {} {}", kind, runtime)),
    }

    conn.execute(
        "UPDATE extensions SET enabled=?1, updated_at=?2 WHERE id=?3",
        params![enabled as i32, now_iso(), id],
    )
    .map_err(|e| e.to_string())?;

    log_activity(conn, "ext_toggle", &format!("{} {} {}", kind, name, if enabled { "on" } else { "off" }));
    Ok(())
}

fn toggle_claude_mcp(name: &str, config_json: &str, enabled: bool) -> Result<(), String> {
    let path = claude_json_path();
    let mut root = read_json(&path);
    let servers = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or("mcpServers not found")?;
    if enabled {
        let cfg: serde_json::Value =
            serde_json::from_str(config_json).unwrap_or(serde_json::json!({}));
        servers.insert(name.to_string(), cfg);
    } else {
        servers.remove(name);
    }
    write_json(&path, &root)
}

fn toggle_codex_mcp(name: &str, enabled: bool) -> Result<(), String> {
    let path = codex_config_path();
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(servers) = doc.get_mut("mcp_servers").and_then(|v| v.as_table_mut()) {
        if let Some(server) = servers.get_mut(name).and_then(|v| v.as_table_mut()) {
            if enabled {
                server.remove("enabled");
            } else {
                server.insert("enabled".into(), toml::Value::Boolean(false));
            }
        }
    }
    let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())
}

fn toggle_claude_hook(event: &str, config_json: &str, enabled: bool) -> Result<(), String> {
    let path = claude_settings_path();
    let mut root = read_json(&path);
    let hooks = root
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or("hooks not found")?;

    let cfg: serde_json::Value =
        serde_json::from_str(config_json).unwrap_or(serde_json::json!({}));
    let command = cfg.get("command").and_then(|v| v.as_str()).unwrap_or("");
    let matcher = cfg.get("matcher").and_then(|v| v.as_str()).unwrap_or("*");
    let timeout = cfg.get("timeout").and_then(|v| v.as_i64()).unwrap_or(10);

    let entry_arr = hooks
        .entry(event.to_string())
        .or_insert_with(|| serde_json::json!([]));
    let arr = entry_arr.as_array_mut().ok_or("hooks entry not array")?;

    if enabled {
        let new_entry = serde_json::json!({
            "matcher": matcher,
            "hooks": [{ "type": "command", "command": command, "timeout": timeout }]
        });
        // avoid duplicate
        let exists = arr.iter().any(|e| {
            e.get("hooks")
                .and_then(|h| h.as_array())
                .and_then(|a| a.first())
                .and_then(|h| h.get("command"))
                .and_then(|c| c.as_str())
                == Some(command)
        });
        if !exists {
            arr.push(new_entry);
        }
    } else {
        arr.retain(|e| {
            e.get("hooks")
                .and_then(|h| h.as_array())
                .and_then(|a| a.first())
                .and_then(|h| h.get("command"))
                .and_then(|c| c.as_str())
                != Some(command)
        });
        if arr.is_empty() {
            hooks.remove(event);
        }
    }
    write_json(&path, &root)
}

fn toggle_codex_plugin(config_json: &str, enabled: bool) -> Result<(), String> {
    let cfg: serde_json::Value =
        serde_json::from_str(config_json).unwrap_or(serde_json::json!({}));
    let full_name = cfg
        .get("full_name")
        .and_then(|v| v.as_str())
        .ok_or("missing full_name")?;

    let path = codex_config_path();
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
    let plugins = doc
        .get_mut("plugins")
        .and_then(|v| v.as_table_mut())
        .ok_or("plugins section not found")?;

    if enabled {
        let mut t = toml::value::Table::new();
        t.insert("enabled".into(), toml::Value::Boolean(true));
        plugins.insert(full_name.to_string(), toml::Value::Table(t));
    } else {
        if let Some(t) = plugins.get_mut(full_name).and_then(|v| v.as_table_mut()) {
            t.insert("enabled".into(), toml::Value::Boolean(false));
        } else {
            let mut t = toml::value::Table::new();
            t.insert("enabled".into(), toml::Value::Boolean(false));
            plugins.insert(full_name.to_string(), toml::Value::Table(t));
        }
    }
    let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())
}

// ============ save MCP ============

fn json_to_toml(value: &serde_json::Value) -> Result<toml::Value, String> {
    match value {
        serde_json::Value::Object(map) => {
            let mut table = toml::value::Table::new();
            for (key, item) in map {
                table.insert(key.clone(), json_to_toml(item)?);
            }
            Ok(toml::Value::Table(table))
        }
        serde_json::Value::Array(items) => Ok(toml::Value::Array(
            items.iter().map(json_to_toml).collect::<Result<Vec<_>, _>>()?,
        )),
        serde_json::Value::String(s) => Ok(toml::Value::String(s.clone())),
        serde_json::Value::Bool(b) => Ok(toml::Value::Boolean(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(toml::Value::Integer(i))
            } else {
                n.as_f64()
                    .map(toml::Value::Float)
                    .ok_or_else(|| format!("unsupported JSON number: {}", n))
            }
        }
        serde_json::Value::Null => Err("MCP JSON contains a null value, which cannot be written to TOML".into()),
    }
}

fn mcp_description(cfg: &serde_json::Value) -> String {
    cfg.get("command")
        .or_else(|| cfg.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

pub fn save_mcp(conn: &Connection, input: &McpServerInput) -> Result<(), String> {
    let runtime = input.runtime.clone();
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("server name is required".into());
    }

    let cfg = serde_json::from_str::<serde_json::Value>(&input.config_json)
        .map_err(|e| format!("invalid MCP JSON: {}", e))?;
    if !cfg.is_object() {
        return Err("MCP server configuration must be a JSON object".into());
    }

    let id = format!("mcp:{}:{}", runtime, name);
    let old_name = input.old_name.as_deref().map(str::trim).unwrap_or(&name);
    let old_id = format!("mcp:{}:{}", runtime, old_name);

    match runtime.as_str() {
        "claude" => {
            let path = claude_json_path();
            let mut root = read_json(&path);
            let servers = root
                .get_mut("mcpServers")
                .and_then(|v| v.as_object_mut())
                .ok_or("mcpServers not found")?;
            if old_name != name {
                servers.remove(old_name);
            }
            servers.insert(name.clone(), cfg.clone());
            write_json(&path, &root)?;

            if old_name != name {
                conn.execute("DELETE FROM extensions WHERE id=?1", params![old_id]).ok();
            }
            conn.execute(
                "INSERT INTO extensions (id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at)
                 VALUES (?1,'mcp',?2,?3,?4,1,?5,'manual',?6,?6)
                 ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json, description=excluded.description, updated_at=excluded.updated_at",
                params![id, runtime, name, cfg.to_string(), mcp_description(&cfg), now_iso()],
            )
            .ok();
        }
        "codex" => {
            let path = codex_config_path();
            let raw = fs::read_to_string(&path).unwrap_or_default();
            let mut doc: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
            let servers = doc
                .get_mut("mcp_servers")
                .and_then(|v| v.as_table_mut())
                .ok_or("mcp_servers not found")?;
            if old_name != name {
                servers.remove(old_name);
            }
            let server_value = json_to_toml(&cfg)?;
            let table = match server_value {
                toml::Value::Table(table) => table,
                _ => return Err("MCP server configuration must be a JSON object".into()),
            };
            servers.insert(name.clone(), toml::Value::Table(table));
            let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
            fs::write(&path, out).map_err(|e| e.to_string())?;

            if old_name != name {
                conn.execute("DELETE FROM extensions WHERE id=?1", params![old_id]).ok();
            }
            conn.execute(
                "INSERT INTO extensions (id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at)
                 VALUES (?1,'mcp',?2,?3,?4,1,?5,'manual',?6,?6)
                 ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json, description=excluded.description, updated_at=excluded.updated_at",
                params![id, runtime, name, cfg.to_string(), mcp_description(&cfg), now_iso()],
            )
            .ok();
        }
        _ => return Err(format!("unsupported runtime: {}", runtime)),
    }

    log_activity(conn, "mcp_save", &name);
    Ok(())
}

// ============ save hook ============

pub fn save_hook(conn: &Connection, input: &HookInput) -> Result<(), String> {
    let id = format!("hook:{}:{}:{}", input.runtime, input.event, short_hash(&input.command));
    let cfg = serde_json::json!({
        "matcher": input.matcher,
        "command": input.command,
        "timeout": input.timeout,
    });

    // Only Claude supports hooks
    toggle_claude_hook(&input.event, &cfg.to_string(), true)?;

    conn.execute(
        "INSERT INTO extensions (id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at)
         VALUES (?1,'hook','claude',?2,?3,1,?4,'manual',?5,?5)
         ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at",
        params![id, input.event, cfg.to_string(), input.command.chars().take(80).collect::<String>(), now_iso()],
    )
    .ok();

    log_activity(conn, "hook_save", &input.event);
    Ok(())
}

// ============ delete ============

pub fn delete_extension(conn: &Connection, id: &str) -> Result<(), String> {
    let (kind, runtime, name, config_json): (String, String, String, String) = conn
        .query_row(
            "SELECT kind, runtime, name, config_json FROM extensions WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "extension not found".to_string())?;

    // Remove from config file
    match (kind.as_str(), runtime.as_str()) {
        ("mcp", "claude") => {
            let path = claude_json_path();
            let mut root = read_json(&path);
            if let Some(servers) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                servers.remove(&name);
            }
            write_json(&path, &root)?;
        }
        ("mcp", "codex") => {
            let path = codex_config_path();
            let raw = fs::read_to_string(&path).unwrap_or_default();
            let mut doc: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
            if let Some(servers) = doc.get_mut("mcp_servers").and_then(|v| v.as_table_mut()) {
                servers.remove(&name);
            }
            let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
            fs::write(&path, out).map_err(|e| e.to_string())?;
        }
        ("hook", "claude") => {
            toggle_claude_hook(&name, &config_json, false)?;
        }
        ("plugin", "codex") => {
            let path = codex_config_path();
            let raw = fs::read_to_string(&path).unwrap_or_default();
            let mut doc: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
            if let Some(plugins) = doc.get_mut("plugins").and_then(|v| v.as_table_mut()) {
                let cfg: serde_json::Value = serde_json::from_str(&config_json).unwrap_or_default();
                let full_name = cfg.get("full_name").and_then(|v| v.as_str()).unwrap_or(&name);
                plugins.remove(full_name);
            }
            let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
            fs::write(&path, out).map_err(|e| e.to_string())?;
        }
        _ => {}
    }

    conn.execute("DELETE FROM extensions WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_activity(conn, "ext_delete", &format!("{} {}", kind, name));
    Ok(())
}

// ============ tauri commands ============

#[tauri::command]
pub fn scan_ext(db: State<DbState>) -> Result<Vec<ExtensionRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(scan_extensions(&conn))
}

#[tauri::command]
pub fn get_ext(db: State<DbState>) -> Result<Vec<ExtensionRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(get_extensions(&conn))
}

#[tauri::command]
pub fn toggle_ext(db: State<DbState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    toggle_extension(&conn, &id, enabled)
}

#[tauri::command]
pub fn save_mcp_cmd(db: State<DbState>, input: McpServerInput) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    save_mcp(&conn, &input)
}

#[tauri::command]
pub fn save_hook_cmd(db: State<DbState>, input: HookInput) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    save_hook(&conn, &input)
}

#[tauri::command]
pub fn toggle_plugin_cmd(db: State<DbState>, input: PluginToggleInput) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let full_name = if input.marketplace.is_empty() {
        input.name.clone()
    } else {
        format!("{}@{}", input.name, input.marketplace)
    };
    let id = format!("plugin:codex:{}", full_name);
    let config_json = serde_json::json!({
        "full_name": full_name,
        "marketplace": input.marketplace,
    })
    .to_string();
    // Ensure DB row exists
    conn.execute(
        "INSERT OR IGNORE INTO extensions (id, kind, runtime, name, config_json, enabled, description, source, created_at, updated_at)
         VALUES (?1,'plugin','codex',?2,?3,0,'','scan',?4,?4)",
        params![id, input.name, config_json, now_iso()],
    )
    .ok();
    toggle_codex_plugin(&config_json, input.enabled)?;
    conn.execute(
        "UPDATE extensions SET enabled=?1, config_json=?2, updated_at=?3 WHERE id=?4",
        params![input.enabled as i32, config_json, now_iso(), id],
    )
    .ok();
    log_activity(&conn, "plugin_toggle", &full_name);
    Ok(())
}

#[tauri::command]
pub fn delete_ext(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    delete_extension(&conn, &id)
}


/// 返回某个 extension 所在的配置文件路径（绝对路径字符串）
#[tauri::command]
pub fn ext_config_path(db: State<DbState>, id: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (kind, runtime): (String, String) = conn
        .query_row(
            "SELECT kind, runtime FROM extensions WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "extension not found".to_string())?;
    Ok(config_file_path(&kind, &runtime))
}
