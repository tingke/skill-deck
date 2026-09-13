use crate::db::{
    now_iso, log_activity, PackageConfigEntry, PackageConfigInput,
    PackageDetail, PackageInput, PackageMcpEntry, PackageMcpInput, PackageRow,
    PackageSkillEntry, PackageSkillInput, DbState,
};
use crate::agent_config;
use crate::skill_connections;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;
use zip::write::SimpleFileOptions;

// ============ helpers ============

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// 扫描 skill 库源得到 name -> (skill_id, path)
fn skill_index(conn: &Connection) -> std::collections::HashMap<String, (String, String)> {
    let mut map = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, name, path FROM skills") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for row in rows.flatten() {
                let (id, name, path) = row;
                map.insert(name, (id, path));
            }
        }
    }
    map
}

pub(crate) fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn pretty_json(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| raw.to_string())
}

fn canonical_json(value: &str) -> serde_json::Value {
    serde_json::from_str(value).unwrap_or(serde_json::Value::Null)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageApplyAction {
    pub kind: String,
    pub name: String,
    pub action: String,
    pub target: String,
    pub detail: String,
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageApplyPlan {
    pub package_id: String,
    pub package_name: String,
    pub scope: String,
    pub agent_id: String,
    pub actions: Vec<PackageApplyAction>,
    pub blocked_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageExportResult {
    pub zip_path: String,
    pub redacted_keys: Vec<String>,
    pub included_secrets: bool,
}

fn sensitive_env_key(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    ["TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "API_KEY", "ACCESS_KEY"]
        .iter()
        .any(|marker| key.contains(marker))
        || key.ends_with("_KEY")
}

/// Redact top-level MCP `env` values. Command args and URLs are not treated as
/// secret stores; they are left intact for functional package import.
fn redact_mcp_config(raw: &str) -> Result<(String, Vec<String>), String> {
    let mut value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| error.to_string())?;
    let mut redacted = Vec::new();
    let Some(object) = value.as_object_mut() else {
        return Err("MCP server 配置必须是 JSON 对象".to_string());
    };
    if let Some(env) = object.get_mut("env").and_then(|value| value.as_object_mut()) {
        for (key, item) in env.iter_mut() {
            if sensitive_env_key(key) && item.is_string() {
                *item = serde_json::Value::String(format!("${{{}}}", key));
                redacted.push(key.clone());
            }
        }
    }
    Ok((value.to_string(), redacted))
}

// ============ list / get ============

pub fn list_packages(conn: &Connection) -> Vec<PackageRow> {
    let mut stmt = match conn.prepare(
        "SELECT p.id, p.name, p.display_name, p.version, p.description,
                p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM package_skills s WHERE s.package_id = p.id) AS sc,
                (SELECT COUNT(*) FROM package_mcps m WHERE m.package_id = p.id) AS mc,
                (SELECT COUNT(*) FROM package_configs c WHERE c.package_id = p.id) AS cc
         FROM packages p ORDER BY COALESCE(NULLIF(p.display_name, ''), p.name) COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| {
        Ok(PackageRow {
            id: row.get(0)?,
            name: row.get(1)?,
            display_name: row.get(2)?,
            version: row.get(3)?,
            description: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            skill_count: row.get(7)?,
            mcp_count: row.get(8)?,
            config_count: row.get(9)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn get_package_detail(conn: &Connection, id: &str) -> Option<PackageDetail> {
    let (id, name, display_name, version, description, created_at, updated_at): (
        String, String, String, String, String, String, String,
    ) = conn
        .query_row(
            "SELECT id, name, display_name, version, description, created_at, updated_at
             FROM packages WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                    row.get(4)?, row.get(5)?, row.get(6)?,
                ))
            },
        )
        .ok()?;

    let skills = list_skills(conn, id.as_str());
    let mcps = list_mcps(conn, id.as_str());
    let configs = list_configs(conn, id.as_str());

    Some(PackageDetail {
        id, name, display_name, version, description, created_at, updated_at,
        skills, mcps, configs,
    })
}

fn list_skills(conn: &Connection, pid: &str) -> Vec<PackageSkillEntry> {
    let mut stmt = match conn.prepare(
        "SELECT name, skill_id, source_path, position FROM package_skills
         WHERE package_id = ?1 ORDER BY position, name",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![pid], |row| {
        Ok(PackageSkillEntry {
            name: row.get(0)?,
            skill_id: row.get(1)?,
            source_path: row.get(2)?,
            position: row.get(3)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

fn list_mcps(conn: &Connection, pid: &str) -> Vec<PackageMcpEntry> {
    let mut stmt = match conn.prepare(
        "SELECT name, config_json, position FROM package_mcps
         WHERE package_id = ?1 ORDER BY position, name",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![pid], |row| {
        Ok(PackageMcpEntry {
            name: row.get(0)?,
            config_json: row.get(1)?,
            position: row.get(2)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

fn list_configs(conn: &Connection, pid: &str) -> Vec<PackageConfigEntry> {
    let mut stmt = match conn.prepare(
        "SELECT agent, category, file_name, content, position FROM package_configs
         WHERE package_id = ?1 ORDER BY position, agent, file_name",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![pid], |row| {
        Ok(PackageConfigEntry {
            agent: row.get(0)?,
            category: row.get(1)?,
            file_name: row.get(2)?,
            content: row.get(3)?,
            position: row.get(4)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ============ create / update / delete ============

pub fn save_package(conn: &Connection, input: &PackageInput, existing_id: Option<&str>) -> Result<String, String> {
    let ts = now_iso();
    let id = match existing_id {
        Some(id) => id.to_string(),
        None => Uuid::new_v4().to_string(),
    };

    if existing_id.is_some() {
        conn.execute(
            "UPDATE packages SET name=?1, display_name=?2, version=?3, description=?4, updated_at=?5 WHERE id=?6",
            params![
                input.name,
                input.display_name.clone().unwrap_or_default(),
                input.version.clone().unwrap_or_else(|| "0.1.0".into()),
                input.description.clone().unwrap_or_default(),
                ts,
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM package_skills WHERE package_id=?1", params![id]).ok();
        conn.execute("DELETE FROM package_mcps WHERE package_id=?1", params![id]).ok();
        conn.execute("DELETE FROM package_configs WHERE package_id=?1", params![id]).ok();
    } else {
        conn.execute(
            "INSERT INTO packages (id, name, display_name, version, description, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?6)",
            params![
                id,
                input.name,
                input.display_name.clone().unwrap_or_default(),
                input.version.clone().unwrap_or_else(|| "0.1.0".into()),
                input.description.clone().unwrap_or_default(),
                ts,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for (i, s) in input.skills.iter().enumerate() {
        conn.execute(
            "INSERT INTO package_skills (package_id, name, skill_id, source_path, position)
             VALUES (?1,?2,?3,?4,?5)",
            params![id, s.name, s.skill_id, s.source_path, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    for (i, m) in input.mcps.iter().enumerate() {
        conn.execute(
            "INSERT INTO package_mcps (package_id, name, config_json, position)
             VALUES (?1,?2,?3,?4)",
            params![id, m.name, m.config_json, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    for (i, c) in input.configs.iter().enumerate() {
        conn.execute(
            "INSERT INTO package_configs (package_id, agent, category, file_name, content, position)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, c.agent, c.category, c.file_name, c.content, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }

    log_activity(conn, "package_save", &input.name);
    Ok(id)
}

pub fn delete_package(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM package_skills WHERE package_id=?1", params![id]).ok();
    conn.execute("DELETE FROM package_mcps WHERE package_id=?1", params![id]).ok();
    conn.execute("DELETE FROM package_configs WHERE package_id=?1", params![id]).ok();
    conn.execute("DELETE FROM packages WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_activity(conn, "package_delete", id);
    Ok(())
}

// ============ apply ============

fn skill_source_path(conn: &Connection, entry: &PackageSkillEntry) -> Option<PathBuf> {
    let source = if let Some(skill_id) = entry.skill_id.as_deref() {
        conn.query_row(
            "SELECT path FROM skills WHERE id = ?1",
            params![skill_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
    } else {
        skill_index(conn).get(&entry.name).map(|(_, path)| path.clone())
    };
    source
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn package_skill_id(conn: &Connection, entry: &PackageSkillEntry) -> Option<String> {
    if let Some(skill_id) = entry.skill_id.as_deref().filter(|value| !value.is_empty()) {
        return Some(skill_id.to_string());
    }
    let source = skill_source_path(conn, entry)?;
    conn.query_row(
        "SELECT id FROM skills WHERE path = ?1 LIMIT 1",
        params![source.to_string_lossy()],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn skill_apply_action(
    conn: &Connection,
    entry: &PackageSkillEntry,
    skills_dir: &Path,
) -> PackageApplyAction {
    let missing = PackageApplyAction {
        kind: "skill".into(),
        name: entry.name.clone(),
        action: "missing".into(),
        target: entry.source_path.clone(),
        detail: "Skill 不在当前库中".into(),
        blocked: true,
    };
    let Some(source) = skill_source_path(conn, entry) else {
        return missing;
    };
    let Ok(canonical_source) = fs::canonicalize(&source) else {
        return PackageApplyAction {
            kind: "skill".into(),
            name: entry.name.clone(),
            action: "missing".into(),
            target: source.to_string_lossy().to_string(),
            detail: "Skill 源目录不存在".into(),
            blocked: true,
        };
    };
    let Some(entry_name) = canonical_source.file_name() else {
        return missing;
    };
    let target = skills_dir.join(entry_name);
    let metadata = fs::symlink_metadata(&target);
    let (action, detail, blocked) = if metadata
        .as_ref()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        if fs::canonicalize(&target).ok().as_ref() == Some(&canonical_source) {
            ("unchanged", "已指向该 Skill", false)
        } else {
            ("conflict", "已存在指向不同目标的软链", true)
        }
    } else if metadata.is_ok() {
        ("conflict", "真实目录或文件不能被覆盖", true)
    } else {
        ("create", "将创建软链", false)
    };
    PackageApplyAction {
        kind: "skill".into(),
        name: entry.name.clone(),
        action: action.into(),
        target: target.to_string_lossy().to_string(),
        detail: detail.into(),
        blocked,
    }
}

fn config_apply_action(target: &Path, content: &str, kind: &str, name: &str) -> PackageApplyAction {
    match fs::read_to_string(target) {
        Ok(existing) if existing == content => PackageApplyAction {
            kind: kind.into(),
            name: name.into(),
            action: "unchanged".into(),
            target: target.to_string_lossy().to_string(),
            detail: "内容一致".into(),
            blocked: false,
        },
        Ok(_) => PackageApplyAction {
            kind: kind.into(),
            name: name.into(),
            action: "overwrite".into(),
            target: target.to_string_lossy().to_string(),
            detail: "将覆盖现有文件".into(),
            blocked: false,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => PackageApplyAction {
            kind: kind.into(),
            name: name.into(),
            action: "create".into(),
            target: target.to_string_lossy().to_string(),
            detail: "将创建文件".into(),
            blocked: false,
        },
        Err(error) => PackageApplyAction {
            kind: kind.into(),
            name: name.into(),
            action: "conflict".into(),
            target: target.to_string_lossy().to_string(),
            detail: format!("无法读取现有文件: {}", error),
            blocked: true,
        },
    }
}

pub fn preview_package_apply(
    conn: &Connection,
    package_id: &str,
    runtime: &str,
) -> Result<PackageApplyPlan, String> {
    let detail = get_package_detail(conn, package_id).ok_or("package not found")?;
    let agent = agent_config::agent_by_id(conn, runtime)?;
    let skills_dir = skill_connections::configured_agent_skills_path(conn, &agent);
    let mut actions = Vec::new();

    for entry in &detail.skills {
        actions.push(skill_apply_action(conn, entry, &skills_dir));
    }
    let target = agent_config::mcp_target(conn, runtime)?;
    let existing = agent_config::read_mcp_entries(&target)?;
    for entry in &detail.mcps {
        let unchanged = existing
            .iter()
            .any(|(name, config)| name == &entry.name && canonical_json(config) == canonical_json(&entry.config_json));
        actions.push(PackageApplyAction {
            kind: "mcp".into(),
            name: entry.name.clone(),
            action: if unchanged { "unchanged".into() } else { "upsert".into() },
            target: target.path.clone(),
            detail: if unchanged {
                "MCP 配置一致".into()
            } else {
                format!("将写入 {}", target.path)
            },
            blocked: false,
        });
    }
    for entry in &detail.configs {
        if entry.agent != runtime {
            continue;
        }
        match agent_config::global_config_target(conn, runtime, &entry.file_name) {
            Ok(target) => actions.push(config_apply_action(&target, &entry.content, "config", &entry.file_name)),
            Err(error) => actions.push(PackageApplyAction {
                kind: "config".into(),
                name: entry.file_name.clone(),
                action: "conflict".into(),
                target: entry.file_name.clone(),
                detail: error,
                blocked: true,
            }),
        }
    }
    let blocked_count = actions.iter().filter(|action| action.blocked).count();
    Ok(PackageApplyPlan {
        package_id: detail.id,
        package_name: detail.name,
        scope: "agent".into(),
        agent_id: runtime.to_string(),
        actions,
        blocked_count,
    })
}

pub fn apply_package(conn: &Connection, package_id: &str, runtime: &str) -> Result<(), String> {
    let plan = preview_package_apply(conn, package_id, runtime)?;
    if plan.blocked_count > 0 {
        let blocked = plan
            .actions
            .iter()
            .filter(|action| action.blocked)
            .map(|action| format!("{}: {}", action.name, action.detail))
            .collect::<Vec<_>>()
            .join("；");
        return Err(format!("APPLY_BLOCKED:{}", blocked));
    }

    let detail = get_package_detail(conn, package_id).ok_or("package not found")?;
    let agent = agent_config::agent_by_id(conn, runtime)?;
    for entry in &detail.skills {
        let action = skill_apply_action(conn, entry, &skill_connections::configured_agent_skills_path(conn, &agent));
        if action.action != "missing" {
            let Some(skill_id) = package_skill_id(conn, entry) else {
                return Err(format!("无法确定 Skill ID: {}", entry.name));
            };
            skill_connections::connect_skill_connection(conn, &skill_id, runtime)?;
        }
    }

    let target = agent_config::mcp_target(conn, runtime)?;
    for entry in &detail.mcps {
        agent_config::upsert_mcp_entry(&target, &entry.name, &entry.config_json, None, false)?;
    }

    let mut rollback: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    for entry in &detail.configs {
        if entry.agent != runtime {
            continue;
        }
        let target = agent_config::global_config_target(conn, runtime, &entry.file_name)?;
        let old = if target.exists() {
            Some(fs::read(&target).map_err(|error| error.to_string())?)
        } else {
            None
        };
        match agent_config::atomic_write(&target, entry.content.as_bytes()) {
            Ok(()) => rollback.push((target, old)),
            Err(error) => {
                for (path, old) in rollback.iter().rev() {
                    match old {
                        Some(bytes) => {
                            let _ = fs::write(path, bytes);
                        }
                        None => {
                            let _ = fs::remove_file(path);
                        }
                    }
                }
                return Err(format!("写入配置失败，已回滚本次配置文件: {}", error));
            }
        }
    }

    log_activity(conn, "package_apply", &format!("{} -> {}", detail.name, runtime));
    Ok(())
}

// ============ export (manifest.yaml + zip) ============

/// 把 package 导出为 ai-package-spec-v0.1 目录结构并打包成 zip，默认脱敏 MCP env。
pub fn export_package_zip(
    conn: &Connection,
    package_id: &str,
) -> Result<PackageExportResult, String> {
    export_package_zip_to(conn, package_id, None, false)
}

/// 同 export_package_zip，但允许指定输出目录和是否保留真实凭证。
pub fn export_package_zip_to(
    conn: &Connection,
    package_id: &str,
    dest_dir: Option<&str>,
    include_secrets: bool,
) -> Result<PackageExportResult, String> {
    export_package_zip_to_dirs(
        conn,
        package_id,
        &home().join(".ai-capability-manager").join("exports"),
        dest_dir,
        include_secrets,
    )
}

fn export_package_zip_to_dirs(
    conn: &Connection,
    package_id: &str,
    staging_root: &Path,
    dest_dir: Option<&str>,
    include_secrets: bool,
) -> Result<PackageExportResult, String> {
    let d = get_package_detail(conn, package_id)
        .ok_or_else(|| "package not found".to_string())?;

    let stamp = now_iso();
    let out_dir = staging_root.join(format!("{}-{}", sanitize(&d.name), stamp));
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let mut components_yaml = String::new();
    let mut redacted_keys = Vec::new();

    // skills/<name>/
    if !d.skills.is_empty() {
        let skills_root = out_dir.join("skills");
        fs::create_dir_all(&skills_root).ok();
        let idx = skill_index(conn);
        for s in &d.skills {
            let src = s
                .skill_id
                .as_ref()
                .and_then(|sid| {
                    conn.query_row(
                        "SELECT path FROM skills WHERE id=?1",
                        params![sid],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .or_else(|| idx.get(&s.name).map(|(_, p)| p.clone()))
                .unwrap_or_default();
            if src.is_empty() {
                continue;
            }
            let dst = skills_root.join(&s.name);
            copy_dir_recursive(Path::new(&src), &dst)?;
            components_yaml.push_str(&format!(
                "  - type: skill\n    name: \"{}\"\n    path: skills/{}\n",
                yaml_escape(&s.name), s.name
            ));
        }
    }

    // mcp/<name>.json
    if !d.mcps.is_empty() {
        let mcp_root = out_dir.join("mcp");
        fs::create_dir_all(&mcp_root).ok();
        for m in &d.mcps {
            let fname = format!("{}.json", sanitize(&m.name));
            let dst = mcp_root.join(&fname);
            let (config_json, keys) = if include_secrets {
                (pretty_json(&m.config_json), Vec::new())
            } else {
                let (redacted, keys) = redact_mcp_config(&m.config_json)?;
                (pretty_json(&redacted), keys)
            };
            redacted_keys.extend(keys.iter().map(|key| format!("{}.env.{}", m.name, key)));
            fs::write(&dst, config_json).map_err(|e| e.to_string())?;
            components_yaml.push_str(&format!(
                "  - type: mcp\n    name: \"{}\"\n    path: mcp/{}\n",
                yaml_escape(&m.name), fname
            ));
        }
    }

    // rules/<agent>-<filename>
    if !d.configs.is_empty() {
        let rules_root = out_dir.join("rules");
        fs::create_dir_all(&rules_root).ok();
        for c in &d.configs {
            let fname = format!("{}-{}", sanitize(&c.agent), sanitize(&c.file_name));
            let dst = rules_root.join(&fname);
            fs::write(&dst, &c.content).map_err(|e| e.to_string())?;
            components_yaml.push_str(&format!(
                "  - type: rule\n    name: \"{}:{}\"\n    path: rules/{}\n",
                yaml_escape(&c.agent), yaml_escape(&c.file_name), fname
            ));
        }
    }

    // manifest.yaml
    let mut yaml = String::new();
    yaml.push_str("specVersion: \"0.1\"\n");
    yaml.push_str(&format!("name: \"{}\"\n", yaml_escape(&d.name)));
    if !d.display_name.is_empty() {
        yaml.push_str(&format!("displayName: \"{}\"\n", yaml_escape(&d.display_name)));
    }
    yaml.push_str(&format!("version: \"{}\"\n", yaml_escape(&d.version)));
    if !d.description.is_empty() {
        yaml.push_str(&format!("description: \"{}\"\n", yaml_escape(&d.description)));
    }
    yaml.push_str("runtime:\n  supported: [claude, codex]\n");
    yaml.push_str("permissions: {}\n");
    if !components_yaml.is_empty() {
        yaml.push_str("components:\n");
        yaml.push_str(&components_yaml);
    }
    fs::write(out_dir.join("manifest.yaml"), yaml).map_err(|e| e.to_string())?;

    // 打包 zip
    let zip_name = format!("{}.ai-package.zip", sanitize(&d.name));
    let zip_path = match dest_dir {
        Some(dir) => PathBuf::from(dir).join(&zip_name),
        None => out_dir.with_extension("ai-package.zip"),
    };
    let file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zipper = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    walk_and_zip(&out_dir, &out_dir, &mut zipper, opts)?;
    zipper.finish().map_err(|e| e.to_string())?;

    log_activity(conn, "package_export", &d.name);
    Ok(PackageExportResult {
        zip_path: zip_path.to_string_lossy().to_string(),
        redacted_keys,
        included_secrets: include_secrets,
    })
}

fn yaml_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn walk_and_zip<W: Write + std::io::Seek>(
    base: &Path,
    cur: &Path,
    zip: &mut zip::ZipWriter<W>,
    opts: SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(cur).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(base).unwrap_or(&path);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            walk_and_zip(base, &path, zip, opts)?;
        } else {
            zip.start_file(rel_str, opts).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let target = dst.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

struct TempImportDir(PathBuf);

impl TempImportDir {
    fn new(label: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!(
            "skilldeck-package-{}-{}",
            label,
            Uuid::new_v4()
        ));
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        Ok(Self(path))
    }
}

impl Drop for TempImportDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn validate_zip_name(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if path.is_absolute() {
        return Err(format!("压缩包包含绝对路径条目: {}", name));
    }
    if path
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("压缩包包含非法路径条目: {}", name));
    }
    Ok(())
}

fn extract_zip_directory<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    directory: &str,
    destination: &Path,
) -> Result<(), String> {
    let prefix = if directory.ends_with('/') {
        directory.to_string()
    } else {
        format!("{}/", directory)
    };
    validate_zip_name(directory.trim_end_matches('/'))?;
    let mut found = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        validate_zip_name(&name)?;
        let Some(relative) = name.strip_prefix(&prefix) else {
            continue;
        };
        found = true;
        if relative.is_empty() {
            continue;
        }
        validate_zip_name(relative)?;
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = fs::File::create(&target).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }
    }
    if !found {
        return Err(format!("压缩包缺少组件目录: {}", directory));
    }
    Ok(())
}

fn bundled_skill_root(directory: &Path) -> Result<PathBuf, String> {
    if directory.join("SKILL.md").is_file()
        || directory.join("SKILL.md.disabled").is_file()
    {
        return Ok(directory.to_path_buf());
    }
    Err(format!(
        "压缩包 Skill 缺少 SKILL.md: {}",
        directory.to_string_lossy()
    ))
}

// ============ import ============

/// 从 AI Package zip 导入：解析 manifest + 组件，落库为 package。
/// manifest 兼容 YAML 与 JSON 两种形式（用最小解析器抽取顶层字段）。
pub fn import_package_zip(
    conn: &Connection,
    zip_path: &str,
    library_source_id: Option<&str>,
    override_audit: bool,
) -> Result<String, String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut manifest_raw = String::new();
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with("manifest.yaml") || name.ends_with("manifest.yml")
            || name.ends_with("manifest.json")
        {
            entry.read_to_string(&mut manifest_raw).map_err(|e| e.to_string())?;
            found = true;
            break;
        }
    }
    if !found {
        return Err("zip 内未找到 manifest.yaml / manifest.json".into());
    }
    let library_source_id = match library_source_id.filter(|value| !value.trim().is_empty()) {
        Some(id) => id.to_string(),
        None => conn
            .query_row(
                "SELECT id FROM library_sources WHERE enabled = 1 ORDER BY sort_order, id LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "没有可用库源，无法导入打包 Skill".to_string())?,
    };

    let (name, display_name, version, description, components) =
        parse_manifest(&manifest_raw)?;
    let id = build_package_from_components(
        conn,
        &mut archive,
        &name,
        &display_name,
        &version,
        &description,
        &components,
        &library_source_id,
        override_audit,
    )?;
    log_activity(conn, "package_import", &name);
    Ok(id)
}

/// 把 ai-package 组件列表物化为 package（落库）
fn build_package_from_components<R: Read + std::io::Seek>(
    conn: &Connection,
    archive: &mut zip::ZipArchive<R>,
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
    components: &[ManifestComponent],
    library_source_id: &str,
    override_audit: bool,
) -> Result<String, String> {
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let idx = skill_index(&transaction);
    let mut skills: Vec<PackageSkillInput> = Vec::new();
    let mut mcps: Vec<PackageMcpInput> = Vec::new();
    let mut configs: Vec<PackageConfigInput> = Vec::new();

    for comp in components {
        match comp.kind.as_str() {
            "skill" => {
                if let Some((sid, sp)) = idx.get(&comp.name).cloned() {
                    skills.push(PackageSkillInput {
                        name: comp.name.clone(),
                        skill_id: Some(sid),
                        source_path: sp,
                    });
                    continue;
                }

                let staging = TempImportDir::new("skill")?;
                let extracted = staging.0.join(&comp.name);
                extract_zip_directory(archive, &comp.path, &extracted)?;
                let root = bundled_skill_root(&extracted)?;
                let result = crate::skill_install::install_skill_impl(
                    &transaction,
                    &crate::skill_install::SkillSourceInput {
                        kind: "path".to_string(),
                        source_ref: root.to_string_lossy().to_string(),
                    },
                    library_source_id,
                    override_audit,
                )?;
                let Some(skill_id) = result.skill_id else {
                    return Err(format!(
                        "导入打包 Skill 被拦截（{}）: {}",
                        result.status, result.message
                    ));
                };
                skills.push(PackageSkillInput {
                    name: comp.name.clone(),
                    skill_id: Some(skill_id),
                    source_path: result.target_path,
                });
            }
            "mcp" => {
                let cfg = read_zip_text(archive, &comp.path)
                    .ok_or_else(|| format!("压缩包缺少 MCP 组件: {}", comp.path))?;
                mcps.push(PackageMcpInput { name: comp.name.clone(), config_json: cfg });
            }
            "rule" => {
                let content = read_zip_text(archive, &comp.path)
                    .ok_or_else(|| format!("压缩包缺少规则组件: {}", comp.path))?;
                let (agent, file_name) = match comp.name.split_once(':') {
                    Some((a, f)) => (a.to_string(), f.to_string()),
                    None => ("claude".into(), "CLAUDE.md".into()),
                };
                agent_config::safe_config_target(Path::new("/"), &file_name)?;
                configs.push(PackageConfigInput {
                    agent, category: "rules".into(), file_name, content,
                });
            }
            unknown => return Err(format!("不支持的 package 组件类型: {}", unknown)),
        }
    }

    let input = PackageInput {
        name: name.to_string(),
        display_name: Some(display_name.to_string()),
        version: Some(version.to_string()),
        description: Some(description.to_string()),
        skills,
        mcps,
        configs,
    };
    let package_id = save_package(&transaction, &input, None)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(package_id)
}


#[derive(Debug)]
struct ManifestComponent {
    kind: String,
    name: String,
    path: String,
}

/// 最小 manifest 解析：兼容 YAML 缩进列表与 JSON。只抽取我们关心的字段。
fn parse_manifest(raw: &str) -> Result<(String, String, String, String, Vec<ManifestComponent>), String> {
    // 尝试 JSON
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let display_name = v.get("displayName").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let version = v.get("version").and_then(|x| x.as_str()).unwrap_or("0.1.0").to_string();
        let description = v.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let comps = parse_components_json(v.get("components"));
        return Ok((name, display_name, version, description, comps));
    }

    // 否则按 YAML 行解析
    let mut name = String::new();
    let mut display_name = String::new();
    let mut version = String::new();
    let mut description = String::new();
    let mut components: Vec<ManifestComponent> = Vec::new();

    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("name:") {
            name = unquote(rest.trim());
        } else if let Some(rest) = trimmed.strip_prefix("displayName:") {
            display_name = unquote(rest.trim());
        } else if let Some(rest) = trimmed.strip_prefix("version:") {
            version = unquote(rest.trim());
        } else if let Some(rest) = trimmed.strip_prefix("description:") {
            description = unquote(rest.trim());
        } else if trimmed == "components:" {
            i += 1;
            while i < lines.len() {
                let l = lines[i];
                let lt = l.trim();
                if lt.is_empty() {
                    i += 1;
                    continue;
                }
                if !lt.starts_with("- type:") && !lt.starts_with("-type:") {
                    break;
                }
                let mut kind = String::new();
                let mut cname = String::new();
                let mut path = String::new();
                if let Some(rest) = lt.trim_start_matches('-').trim().strip_prefix("type:") {
                    kind = unquote(rest.trim());
                }
                i += 1;
                while i < lines.len() {
                    let nl = lines[i];
                    let nlt = nl.trim();
                    if nlt.is_empty() { i += 1; continue; }
                    if nlt.starts_with("- type:") || !nlt.contains(':') {
                        break;
                    }
                    if !nl.starts_with(' ') && !nl.starts_with('\t') {
                        break;
                    }
                    if let Some(rest) = nlt.strip_prefix("name:") {
                        cname = unquote(rest.trim());
                    } else if let Some(rest) = nlt.strip_prefix("path:") {
                        path = unquote(rest.trim());
                    }
                    i += 1;
                }
                if !kind.is_empty() {
                    components.push(ManifestComponent { kind, name: cname, path });
                }
            }
            i -= 1;
            continue;
        }
        i += 1;
    }

    if name.is_empty() {
        return Err("manifest 缺少 name".into());
    }
    if version.is_empty() {
        version = "0.1.0".into();
    }
    Ok((name, display_name, version, description, components))
}

fn parse_components_json(v: Option<&serde_json::Value>) -> Vec<ManifestComponent> {
    let mut out = Vec::new();
    if let Some(arr) = v.and_then(|x| x.as_array()) {
        for c in arr {
            out.push(ManifestComponent {
                kind: c.get("type").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                name: c.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                path: c.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            });
        }
    }
    out
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn read_zip_text<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).ok()?;
        if entry.name() == name || entry.name().ends_with(name) {
            let mut s = String::new();
            entry.read_to_string(&mut s).ok()?;
            return Some(s);
        }
    }
    None
}

// ============ tauri commands ============

#[tauri::command]
pub fn get_packages(db: State<DbState>) -> Result<Vec<PackageRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(list_packages(&conn))
}

#[tauri::command]
pub fn get_package(db: State<DbState>, id: String) -> Result<PackageDetail, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_package_detail(&conn, &id).ok_or_else(|| "package not found".to_string())
}

#[tauri::command]
pub fn save_pkg(
    db: State<DbState>,
    input: PackageInput,
    id: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    save_package(&conn, &input, id.as_deref())
}

#[tauri::command]
pub fn delete_pkg(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    delete_package(&conn, &id)
}

#[tauri::command(async)]
pub fn apply_pkg(db: State<DbState>, id: String, runtime: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    apply_package(&conn, &id, &runtime)
}

#[tauri::command(async)]
pub fn preview_pkg(
    db: State<DbState>,
    id: String,
    runtime: String,
) -> Result<PackageApplyPlan, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    preview_package_apply(&conn, &id, &runtime)
}

#[tauri::command(async)]
pub fn export_pkg(
    db: State<DbState>,
    id: String,
    dest_dir: Option<String>,
    include_secrets: Option<bool>,
) -> Result<PackageExportResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    export_package_zip_to(
        &conn,
        &id,
        dest_dir.as_deref(),
        include_secrets.unwrap_or(false),
    )
}

#[tauri::command(async)]
pub fn import_pkg(
    db: State<DbState>,
    zip_path: String,
    library_source_id: Option<String>,
    override_audit: Option<bool>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    import_package_zip(
        &conn,
        &zip_path,
        library_source_id.as_deref(),
        override_audit.unwrap_or(false),
    )
}

/// 选择导出保存目录（macOS 原生文件夹选择器），返回绝对路径
#[tauri::command]
pub fn pick_save_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择导出位置")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

// ============ project apply + folder picker ============

/// 打开系统文件夹选择对话框，返回选中目录的绝对路径（取消则返回 None）
#[tauri::command]
pub fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择项目目录")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

/// 把 package 应用到项目目录。配置路径只允许项目根下的一个 basename；覆盖已有
/// 配置必须显式确认。项目级 MCP 格式差异较大，当前仍显式跳过。
pub fn apply_package_to_project(
    conn: &Connection,
    package_id: &str,
    project_path: &str,
    confirmed_overwrite: bool,
) -> Result<(), String> {
    let detail = get_package_detail(conn, package_id)
        .ok_or_else(|| "package not found".to_string())?;
    let project = PathBuf::from(project_path);
    if !project.is_dir() {
        return Err(format!("不是有效目录: {}", project_path));
    }
    let project = fs::canonicalize(&project).map_err(|error| error.to_string())?;
    let agents_dir = project.join(".agents");
    if fs::symlink_metadata(&agents_dir)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(".agents 是软链，拒绝写入: {}", agents_dir.to_string_lossy()));
    }
    let skills_dir = agents_dir.join("skills");
    if fs::symlink_metadata(&skills_dir)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("skills 是软链，拒绝写入: {}", skills_dir.to_string_lossy()));
    }

    let mut resolved_skills = Vec::new();
    for entry in &detail.skills {
        let action = skill_apply_action(conn, entry, &skills_dir);
        if action.blocked {
            return Err(format!("APPLY_BLOCKED:{}: {}", entry.name, action.detail));
        }
        let source = skill_source_path(conn, entry).ok_or_else(|| format!("Skill 不在当前库中: {}", entry.name))?;
        let Some(skill_id) = package_skill_id(conn, entry) else {
            return Err(format!("无法确定 Skill ID: {}", entry.name));
        };
        resolved_skills.push((skill_id, source));
    }

    let mut resolved_configs = Vec::new();
    for entry in &detail.configs {
        let target = agent_config::safe_config_target(&project, &entry.file_name)?;
        let existing = fs::read_to_string(&target);
        if let Ok(existing) = existing {
            if existing != entry.content && !confirmed_overwrite {
                return Err(format!(
                    "CONFIRM_PROJECT_OVERWRITE:{}",
                    target.to_string_lossy()
                ));
            }
        }
        resolved_configs.push((target, entry.content.clone()));
    }

    fs::create_dir_all(&skills_dir).map_err(|error| error.to_string())?;
    for (skill_id, source) in resolved_skills {
        let canonical_source = fs::canonicalize(&source).map_err(|error| error.to_string())?;
        let Some(entry_name) = canonical_source.file_name() else {
            return Err("invalid skill source path".to_string());
        };
        let link = skills_dir.join(entry_name);
        if link.exists() || link.is_symlink() {
            continue;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&canonical_source, &link).map_err(|error| error.to_string())?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&canonical_source, &link)
            .map_err(|error| error.to_string())?;
        let linked = canonical_source.join("SKILL.md").is_file();
        conn.execute(
            "INSERT INTO connections (skill_id, runtime, linked, symlink_path, updated_at)
             VALUES (?1, '.agents', ?2, ?3, ?4)
             ON CONFLICT(skill_id, runtime) DO UPDATE SET
                linked=excluded.linked, symlink_path=excluded.symlink_path, updated_at=excluded.updated_at",
            params![skill_id, linked as i64, link.to_string_lossy(), crate::db::now_iso()],
        )
        .ok();
    }

    for (target, content) in resolved_configs {
        agent_config::atomic_write(&target, content.as_bytes())?;
    }

    log_activity(conn, "package_apply_project", &format!("{} -> {}", detail.name, project_path));
    Ok(())
}

#[tauri::command(async)]
pub fn apply_pkg_to_project(
    db: State<DbState>,
    id: String,
    project_path: String,
    confirmed_overwrite: Option<bool>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    apply_package_to_project(&conn, &id, &project_path, confirmed_overwrite.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        open_in_memory, PackageConfigInput, PackageInput, PackageMcpInput, PackageSkillInput,
    };

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("skilldeck-pkg-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn insert_skill(conn: &Connection, id: &str, name: &str, path: &Path) {
        conn.execute(
            "INSERT INTO skills (id, name, source_lib, path, created_at, updated_at)
             VALUES (?1, ?2, 'main', ?3, '1', '1')",
            params![id, name, path.to_string_lossy().to_string()],
        )
        .unwrap();
    }

    fn demo_input(skill_path: &str) -> PackageInput {
        PackageInput {
            name: "demo".into(),
            display_name: Some("Demo Pack".into()),
            version: Some("1.2.0".into()),
            description: Some("round trip".into()),
            skills: vec![PackageSkillInput {
                name: "my-skill".into(),
                skill_id: Some("s1".into()),
                source_path: skill_path.into(),
            }],
            mcps: vec![PackageMcpInput {
                name: "fetch".into(),
                config_json: r#"{"command":"mcp-fetch"}"#.into(),
            }],
            configs: vec![PackageConfigInput {
                agent: "claude".into(),
                category: "rules".into(),
                file_name: "CLAUDE.md".into(),
                content: "# Project Rules".into(),
            }],
        }
    }

    fn zip_entry_contents(path: &Path, suffix: &str) -> String {
        let file = fs::File::open(path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            if entry.name().ends_with(suffix) {
                let mut out = String::new();
                entry.read_to_string(&mut out).unwrap();
                return out;
            }
        }
        panic!("zip entry ending with {suffix} not found");
    }

    #[test]
    fn parse_manifest_supports_yaml_and_json() {
        let yaml = r#"
specVersion: "0.1"
name: "yaml-pack"
displayName: "YAML Pack"
version: "2.0.0"
description: "yaml manifest"
components:
  - type: skill
    name: "my-skill"
    path: skills/my-skill
  - type: mcp
    name: "fetch"
    path: mcp/fetch.json
  - type: rule
    name: "claude:CLAUDE.md"
    path: rules/claude-CLAUDE.md
"#;
        let (name, display, version, description, comps) = parse_manifest(yaml).unwrap();
        assert_eq!((name.as_str(), display.as_str(), version.as_str(), description.as_str()),
            ("yaml-pack", "YAML Pack", "2.0.0", "yaml manifest"));
        assert_eq!(comps.len(), 3);
        assert_eq!(comps[0].kind, "skill");
        assert_eq!(comps[0].name, "my-skill");
        assert_eq!(comps[0].path, "skills/my-skill");

        let json = r#"{
            "name": "json-pack",
            "displayName": "JSON Pack",
            "components": [
                {"type": "mcp", "name": "fetch", "path": "mcp/fetch.json"}
            ]
        }"#;
        let (name, _display, version, _description, comps) = parse_manifest(json).unwrap();
        assert_eq!(name, "json-pack");
        assert_eq!(version, "0.1.0");
        assert_eq!(comps.len(), 1);
        assert_eq!(comps[0].kind, "mcp");
    }

    #[test]
    fn parse_manifest_rejects_missing_name() {
        let err = parse_manifest("version: \"1.0.0\"\n").unwrap_err();
        assert!(err.contains("name"), "unexpected error: {err}");
    }

    #[test]
    fn package_export_import_round_trip() {
        let dir = temp_dir("round-trip");
        let skill_dir = dir.join("lib").join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "---\nname: my-skill\n---\n").unwrap();
        let skill_path = skill_dir.to_string_lossy().to_string();

        let conn = open_in_memory();
        insert_skill(&conn, "s1", "my-skill", &skill_dir);
        let id = save_package(&conn, &demo_input(&skill_path), None).unwrap();

        let staging_root = dir.join("staging");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        let export = export_package_zip_to_dirs(
            &conn,
            &id,
            &staging_root,
            Some(dest_dir.to_str().unwrap()),
            false,
        )
        .unwrap();
        let zip_path = export.zip_path.clone();

        assert_eq!(zip_path, dest_dir.join("demo.ai-package.zip").to_string_lossy().to_string());
        let manifest = zip_entry_contents(Path::new(&zip_path), "manifest.yaml");
        assert!(manifest.contains("name: \"demo\""));
        assert!(manifest.contains("path: skills/my-skill"));
        assert!(manifest.contains("path: mcp/fetch.json"));
        assert!(manifest.contains("path: rules/claude-CLAUDE-md"));
        assert!(zip_entry_contents(Path::new(&zip_path), "mcp/fetch.json").contains("mcp-fetch"));
        assert_eq!(
            zip_entry_contents(Path::new(&zip_path), "rules/claude-CLAUDE-md"),
            "# Project Rules"
        );

        // 导入到全新数据库，skill 靠名称重新关联
        let fresh = open_in_memory();
        insert_skill(&fresh, "s1", "my-skill", &skill_dir);
        let imported_id = import_package_zip(&fresh, &zip_path, Some("main"), false).unwrap();
        let detail = get_package_detail(&fresh, &imported_id).unwrap();
        assert_eq!(detail.name, "demo");
        assert_eq!(detail.display_name, "Demo Pack");
        assert_eq!(detail.version, "1.2.0");
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].skill_id.as_deref(), Some("s1"));
        assert_eq!(detail.mcps.len(), 1);
        assert!(detail.mcps[0].config_json.contains("mcp-fetch"));
        assert_eq!(detail.configs.len(), 1);
        assert_eq!(detail.configs[0].content, "# Project Rules");
    }

    #[test]
    fn import_rejects_zip_without_manifest() {
        let dir = temp_dir("no-manifest");
        let zip_path = dir.join("bad.ai-package.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default();
        writer.start_file("skills/x/SKILL.md", opts).unwrap();
        writer.write_all(b"content").unwrap();
        writer.finish().unwrap();

        let conn = open_in_memory();
        let err = import_package_zip(&conn, zip_path.to_str().unwrap(), Some("main"), false).unwrap_err();
        assert!(err.contains("manifest"), "unexpected error: {err}");
    }

    #[test]
    fn export_redacts_sensitive_env_values_by_default() {
        let (redacted, keys) =
            redact_mcp_config(r#"{"command":"fetch","env":{"API_KEY":"raw","DEBUG":"1"}}"#)
                .unwrap();
        let value: serde_json::Value = serde_json::from_str(&redacted).unwrap();
        assert_eq!(value["env"]["API_KEY"], "${API_KEY}");
        assert_eq!(value["env"]["DEBUG"], "1");
        assert_eq!(value["command"], "fetch");
        assert_eq!(keys, vec!["API_KEY".to_string()]);
        assert!(sensitive_env_key("GITHUB_TOKEN"));
        assert!(sensitive_env_key("client_secret"));
        assert!(!sensitive_env_key("timeout"));
    }

    #[test]
    fn import_installs_bundled_skill_into_fresh_library() {
        let dir = temp_dir("self-contained");
        let skill_dir = dir.join("lib").join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\n---\n",
        )
        .unwrap();
        let conn = open_in_memory();
        insert_skill(&conn, "s1", "my-skill", &skill_dir);
        let id = save_package(
            &conn,
            &demo_input(&skill_dir.to_string_lossy().to_string()),
            None,
        )
        .unwrap();
        let staging_root = dir.join("staging");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        let export = export_package_zip_to_dirs(
            &conn,
            &id,
            &staging_root,
            Some(dest_dir.to_str().unwrap()),
            false,
        )
        .unwrap();
        let manifest = zip_entry_contents(Path::new(&export.zip_path), "manifest.yaml");
        assert_eq!(parse_manifest(&manifest).unwrap().4.len(), 3);

        let library_dir = dir.join("fresh-library");
        fs::create_dir_all(&library_dir).unwrap();
        let fresh = open_in_memory();
        crate::skill_install::set_staging_root(dir.join("import-staging"));
        fresh.execute(
            "INSERT INTO library_sources (id, name, path, enabled, sort_order, created_at, updated_at)
             VALUES ('test', 'Test', ?1, 1, 0, '1', '1')",
            params![library_dir.to_string_lossy()],
        )
        .unwrap();
        let imported_id =
            import_package_zip(&fresh, &export.zip_path, Some("test"), false).unwrap();
        let detail = get_package_detail(&fresh, &imported_id).unwrap();
        assert_eq!(detail.skills.len(), 1);
        let skill_id = detail.skills[0].skill_id.clone().unwrap();
        assert!(!skill_id.is_empty());
        let source_path: String = fresh
            .query_row(
                "SELECT path FROM skills WHERE id = ?1",
                params![skill_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(source_path.starts_with(library_dir.to_string_lossy().as_ref()));
        assert!(Path::new(&source_path).join("SKILL.md").is_file());
    }

    #[test]
    fn project_apply_rejects_config_path_traversal_and_requires_overwrite_confirmation() {
        let dir = temp_dir("project-guard");
        let project = dir.join("project");
        fs::create_dir_all(&project).unwrap();
        let conn = open_in_memory();
        let id = save_package(
            &conn,
            &PackageInput {
                name: "unsafe".into(),
                display_name: Some("Unsafe".into()),
                version: Some("0.1.0".into()),
                description: None,
                skills: vec![],
                mcps: vec![],
                configs: vec![PackageConfigInput {
                    agent: "claude".into(),
                    category: "rules".into(),
                    file_name: "../outside.md".into(),
                    content: "danger".into(),
                }],
            },
            None,
        )
        .unwrap();
        let traversal =
            apply_package_to_project(&conn, &id, project.to_str().unwrap(), false).unwrap_err();
        assert!(traversal.contains("非法配置文件名"));
        assert!(!dir.join("outside.md").exists());

        let id = save_package(
            &conn,
            &PackageInput {
                name: "overwrite".into(),
                display_name: Some("Overwrite".into()),
                version: Some("0.1.0".into()),
                description: None,
                skills: vec![],
                mcps: vec![],
                configs: vec![PackageConfigInput {
                    agent: "claude".into(),
                    category: "rules".into(),
                    file_name: "CLAUDE.md".into(),
                    content: "next".into(),
                }],
            },
            None,
        )
        .unwrap();
        fs::write(project.join("CLAUDE.md"), "old").unwrap();
        let required =
            apply_package_to_project(&conn, &id, project.to_str().unwrap(), false).unwrap_err();
        assert!(required.contains("CONFIRM_PROJECT_OVERWRITE"));
        assert_eq!(fs::read_to_string(project.join("CLAUDE.md")).unwrap(), "old");
        apply_package_to_project(&conn, &id, project.to_str().unwrap(), true).unwrap();
        assert_eq!(fs::read_to_string(project.join("CLAUDE.md")).unwrap(), "next");
    }

    #[test]
    fn apply_package_to_project_links_skills_and_writes_configs() {
        let dir = temp_dir("apply-project");
        let skill_dir = dir.join("lib").join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "---\nname: my-skill\n---\n").unwrap();

        let conn = open_in_memory();
        insert_skill(&conn, "s1", "my-skill", &skill_dir);
        let id = save_package(
            &conn,
            &demo_input(&skill_dir.to_string_lossy().to_string()),
            None,
        )
        .unwrap();

        let project = dir.join("project");
        fs::create_dir_all(&project).unwrap();
        apply_package_to_project(&conn, &id, project.to_str().unwrap(), false).unwrap();

        let link = project.join(".agents").join("skills").join("my-skill");
        assert!(link.is_symlink());
        assert_eq!(fs::read_link(&link).unwrap(), skill_dir);
        assert_eq!(
            fs::read_to_string(project.join("CLAUDE.md")).unwrap(),
            "# Project Rules"
        );

        let missing = dir.join("missing-project");
        let err = apply_package_to_project(&conn, &id, missing.to_str().unwrap(), false).unwrap_err();
        assert!(err.contains("不是有效目录"), "unexpected error: {err}");
    }
}
