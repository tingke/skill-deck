use crate::db::{
    now_iso, log_activity, PackageConfigEntry, PackageConfigInput,
    PackageDetail, PackageInput, PackageMcpEntry, PackageMcpInput, PackageRow,
    PackageSkillEntry, PackageSkillInput, DbState,
};
use rusqlite::{params, Connection};
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

/// 把 package 落地到指定 runtime：skill 建 symlink、mcp 写入配置、config 写回文件
pub fn apply_package(conn: &Connection, package_id: &str, runtime: &str) -> Result<(), String> {
    let detail = get_package_detail(conn, package_id)
        .ok_or_else(|| "package not found".to_string())?;
    let idx = skill_index(conn);

    // skills: 建 symlink 到 runtime skills 目录
    let skills_dir = crate::commands::runtime_skills_dir(runtime, conn);
    fs::create_dir_all(&skills_dir).ok();
    for s in &detail.skills {
        let src_path = if let Some(ref sid) = s.skill_id {
            conn.query_row(
                "SELECT path FROM skills WHERE id=?1",
                params![sid],
                |row| row.get::<_, String>(0),
            )
            .ok()
        } else {
            idx.get(&s.name).map(|(_, p)| p.clone())
        };
        let src = match src_path {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => continue,
        };
        let dir_name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| s.name.clone());
        let sym = skills_dir.join(&dir_name);
        if sym.exists() || sym.is_symlink() {
            if sym.is_symlink() {
                fs::remove_file(&sym).ok();
            } else {
                continue;
            }
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&src, &sym).ok();
        }
    }

    // mcps: 合并写入 runtime 的 mcp 配置
    for m in &detail.mcps {
        write_mcp_entry(runtime, &m.name, &m.config_json)?;
    }

    // configs: 写回 runtime 对应全局指令文件
    for c in &detail.configs {
        if c.agent != runtime {
            continue;
        }
        let target = global_config_path(runtime, &c.file_name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&target, &c.content).map_err(|e| e.to_string())?;
    }

    log_activity(conn, "package_apply", &format!("{} -> {}", detail.name, runtime));
    Ok(())
}

fn global_config_path(runtime: &str, file_name: &str) -> PathBuf {
    let dir = match runtime {
        "claude" => home().join(".claude"),
        "codex" => home().join(".codex"),
        "trae" => home().join(".trae-cn"),
        _ => home().join(format!(".{}", runtime)),
    };
    dir.join(file_name)
}

fn mcp_config_path(runtime: &str) -> PathBuf {
    match runtime {
        "claude" => home().join(".claude").join("mcp.json"),
        "codex" => home().join(".codex").join("mcp.json"),
        "trae" => home().join(".trae-cn").join("mcp.json"),
        _ => home().join(format!(".{}", runtime)).join("mcp.json"),
    }
}

fn write_mcp_entry(runtime: &str, name: &str, config_json: &str) -> Result<(), String> {
    let cfg_path = mcp_config_path(runtime);
    let mut root: serde_json::Value = if cfg_path.exists() {
        let raw = fs::read_to_string(&cfg_path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({ "mcpServers": {} }))
    } else {
        serde_json::json!({ "mcpServers": {} })
    };
    let entry: serde_json::Value =
        serde_json::from_str(config_json).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(servers) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.insert(name.to_string(), entry);
    }
    if let Some(parent) = cfg_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&cfg_path, out).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ export (manifest.yaml + zip) ============

/// 把 package 导出为 ai-package-spec-v0.1 目录结构并打包成 zip，返回 zip 绝对路径。
pub fn export_package_zip(conn: &Connection, package_id: &str) -> Result<String, String> {
    export_package_zip_to(conn, package_id, None)
}

/// 同 export_package_zip，但允许指定输出目录
pub fn export_package_zip_to(conn: &Connection, package_id: &str, dest_dir: Option<&str>) -> Result<String, String> {
    let d = get_package_detail(conn, package_id)
        .ok_or_else(|| "package not found".to_string())?;

    let stamp = now_iso();
    let out_dir = home()
        .join(".ai-capability-manager")
        .join("exports")
        .join(format!("{}-{}", sanitize(&d.name), stamp));
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let mut components_yaml = String::new();

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
            fs::write(&dst, pretty_json(&m.config_json)).map_err(|e| e.to_string())?;
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
    Ok(zip_path.to_string_lossy().to_string())
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

// ============ import ============

/// 从 AI Package zip 导入：解析 manifest + 组件，落库为 package。
/// manifest 兼容 YAML 与 JSON 两种形式（用最小解析器抽取顶层字段）。
pub fn import_package_zip(conn: &Connection, zip_path: &str) -> Result<String, String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut manifest_raw = String::new();
    let mut manifest_ext = String::new();
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with("manifest.yaml") || name.ends_with("manifest.yml")
            || name.ends_with("manifest.json")
        {
            entry.read_to_string(&mut manifest_raw).map_err(|e| e.to_string())?;
            manifest_ext = if name.ends_with(".json") { "json".into() } else { "yaml".into() };
            found = true;
            break;
        }
    }
    if !found {
        return Err("zip 内未找到 manifest.yaml / manifest.json".into());
    }

    // JSON manifest
    if manifest_ext == "json" {
        if let Ok(_) = serde_json::from_str::<serde_json::Value>(&manifest_raw) {
            let (name, display_name, version, description, components) =
                parse_manifest(&manifest_raw)?;
            return build_package_from_components(conn, &mut archive, &name, &display_name, &version, &description, &components);
        }
    }

    let (name, display_name, version, description, components) =
        parse_manifest(&manifest_raw)?;
    let id = build_package_from_components(
        conn, &mut archive, &name, &display_name, &version, &description, &components,
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
) -> Result<String, String> {
    let idx = skill_index(conn);
    let mut skills: Vec<PackageSkillInput> = Vec::new();
    let mut mcps: Vec<PackageMcpInput> = Vec::new();
    let mut configs: Vec<PackageConfigInput> = Vec::new();

    for comp in components {
        match comp.kind.as_str() {
            "skill" => {
                let (sid, sp) = idx.get(&comp.name).cloned().unwrap_or((String::new(), String::new()));
                skills.push(PackageSkillInput {
                    name: comp.name.clone(),
                    skill_id: if sid.is_empty() { None } else { Some(sid) },
                    source_path: sp,
                });
            }
            "mcp" => {
                let cfg = read_zip_text(archive, &comp.path).unwrap_or_default();
                mcps.push(PackageMcpInput { name: comp.name.clone(), config_json: cfg });
            }
            "rule" => {
                let content = read_zip_text(archive, &comp.path).unwrap_or_default();
                let (agent, file_name) = match comp.name.split_once(':') {
                    Some((a, f)) => (a.to_string(), f.to_string()),
                    None => ("claude".into(), "CLAUDE.md".into()),
                };
                configs.push(PackageConfigInput {
                    agent, category: "rules".into(), file_name, content,
                });
            }
            _ => {}
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
    save_package(conn, &input, None)
}


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

#[tauri::command]
pub fn apply_pkg(db: State<DbState>, id: String, runtime: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    apply_package(&conn, &id, &runtime)
}

#[tauri::command]
pub fn export_pkg(db: State<DbState>, id: String, dest_dir: Option<String>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    export_package_zip_to(&conn, &id, dest_dir.as_deref())
}

#[tauri::command]
pub fn import_pkg(db: State<DbState>, zip_path: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    import_package_zip(&conn, &zip_path)
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

/// 把 package 应用到项目目录：skills 建 symlink 到 <project>/.agents/skills/，
/// configs 直接写到项目根（CLAUDE.md / AGENTS.md 等），MCP 暂跳过（项目级 MCP 配置差异太大）。
pub fn apply_package_to_project(conn: &Connection, package_id: &str, project_path: &str) -> Result<(), String> {
    let detail = get_package_detail(conn, package_id)
        .ok_or_else(|| "package not found".to_string())?;
    let idx = skill_index(conn);
    let project = PathBuf::from(project_path);
    if !project.is_dir() {
        return Err(format!("不是有效目录: {}", project_path));
    }

    // skills → <project>/.agents/skills/
    let skills_dir = project.join(".agents").join("skills");
    fs::create_dir_all(&skills_dir).ok();
    for s in &detail.skills {
        let src_path = if let Some(ref sid) = s.skill_id {
            conn.query_row(
                "SELECT path FROM skills WHERE id=?1",
                params![sid],
                |row| row.get::<_, String>(0),
            )
            .ok()
        } else {
            idx.get(&s.name).map(|(_, p)| p.clone())
        };
        let src = match src_path {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => continue,
        };
        let dir_name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| s.name.clone());
        let sym = skills_dir.join(&dir_name);
        if sym.exists() || sym.is_symlink() {
            if sym.is_symlink() {
                fs::remove_file(&sym).ok();
            } else {
 continue;
            }
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&src, &sym).ok();
        }
    }

    // configs → <project>/<file_name>
    for c in &detail.configs {
        let target = project.join(&c.file_name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, &c.content).map_err(|e| e.to_string())?;
    }

    log_activity(conn, "package_apply_project", &format!("{} -> {}", detail.name, project_path));
    Ok(())
}

#[tauri::command]
pub fn apply_pkg_to_project(db: State<DbState>, id: String, project_path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    apply_package_to_project(&conn, &id, &project_path)
}
