use crate::db::{SkillRow, now_iso, db_enabled_agents};
use rusqlite::{params, Connection};
 use sha2::{Digest, Sha256};
 use std::fs;
 use std::path::{Path, PathBuf};

/// Parsed front matter fields from SKILL.md
pub struct FrontMatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub version: Option<String>,
}

/// Strip surrounding quotes and whitespace from a YAML scalar value
fn yaml_val(v: &str) -> String {
    v.trim().trim_matches('"').trim_matches('\'').to_string()
}

/// Parse SKILL.md frontmatter (YAML between --- markers)
fn parse_frontmatter(content: &str) -> FrontMatter {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        let desc = content
            .lines()
            .skip_while(|l| l.trim().is_empty() || l.starts_with('#'))
            .next()
            .map(|l| l.trim().to_string());
        return FrontMatter {
            name: None,
            description: desc,
            author: None,
            license: None,
            version: None,
        };
    }

    let after_first = &trimmed[3..];
    let end = after_first.find("\n---").unwrap_or(after_first.len());
    let fm_block = &after_first[..end];

    let mut fm = FrontMatter {
        name: None,
        description: None,
        author: None,
        license: None,
        version: None,
    };

    // Handle both flat keys and nested `metadata:` blocks
    let mut in_metadata = false;
    for line in fm_block.lines() {
        let raw = line.trim_end();
        if raw.trim().is_empty() {
            continue;
        }

        // detect indentation change — indented lines belong to parent block
        let is_indented = raw.starts_with(' ') || raw.starts_with('\t');
        if !is_indented {
            in_metadata = false;
        }

        let line_trimmed = raw.trim();
        if line_trimmed == "metadata:" {
            in_metadata = true;
            continue;
        }

        if in_metadata && is_indented {
            // inside metadata: block
            if let Some(v) = line_trimmed.strip_prefix("author:") {
                fm.author = Some(yaml_val(v));
            } else if let Some(v) = line_trimmed.strip_prefix("version:") {
                fm.version = Some(yaml_val(v));
            } else if let Some(v) = line_trimmed.strip_prefix("license:") {
                fm.license = Some(yaml_val(v));
            }
        } else if let Some(v) = line_trimmed.strip_prefix("name:") {
            fm.name = Some(yaml_val(v));
        } else if let Some(v) = line_trimmed.strip_prefix("description:") {
            fm.description = Some(yaml_val(v));
        } else if let Some(v) = line_trimmed.strip_prefix("author:") {
            fm.author = Some(yaml_val(v));
        } else if let Some(v) = line_trimmed.strip_prefix("license:") {
            fm.license = Some(yaml_val(v));
        } else if let Some(v) = line_trimmed.strip_prefix("version:") {
            fm.version = Some(yaml_val(v));
        }
    }

    fm
}

/// Detect permissions from SKILL.md content
fn detect_permissions(content: &str, has_scripts: bool) -> Vec<String> {
    let lower = content.to_lowercase();
    let mut perms = Vec::new();

    if has_scripts {
        perms.push("exec".to_string());
    } else {
        let exec_kw = ["exec", "command", "shell", "bash", "script", "npx", "npm", "python", "cargo", "pip", "run "];
        if exec_kw.iter().any(|k| lower.contains(k)) {
            perms.push("exec".to_string());
        }
    }

    let write_kw = ["write", "create", "modify", "save", "edit", "patch", "apply_patch", "mkdir", "touch"];
    if write_kw.iter().any(|k| lower.contains(k)) {
        perms.push("file:write".to_string());
    }

    let net_kw = ["fetch", "http", "api", "url", "request", "curl", "wget", "endpoint"];
    if net_kw.iter().any(|k| lower.contains(k)) {
        perms.push("network".to_string());
    }

    perms
}

 /// 计算文件内容的 sha256
 fn content_hash(path: &Path) -> String {
     let content = fs::read(path).unwrap_or_default();
     let mut hasher = Sha256::new();
     hasher.update(&content);
     format!("{:x}", hasher.finalize())
 }

 /// 扫描单个 skill 目录，返回解析后的元数据
pub fn scan_skill_dir(dir: &Path, source_lib: &str) -> Option<ScanResult> {
   let name = dir.file_name()?.to_string_lossy().to_string();
   let skill_md = dir.join("SKILL.md");
   let skill_md_disabled = dir.join("SKILL.md.disabled");

   let (parsed_name, description, hash, author, license, version, permissions, disabled) = if skill_md.exists() {
       let content = fs::read_to_string(&skill_md).unwrap_or_default();
       let fm = parse_frontmatter(&content);
       let h = content_hash(&skill_md);
       let has_scripts = dir.join("scripts").is_dir();
       let perms = detect_permissions(&content, has_scripts);
       (fm.name, fm.description, Some(h), fm.author, fm.license, fm.version, perms, false)
   } else if skill_md_disabled.exists() {
       let content = fs::read_to_string(&skill_md_disabled).unwrap_or_default();
       let fm = parse_frontmatter(&content);
       let h = content_hash(&skill_md_disabled);
       let has_scripts = dir.join("scripts").is_dir();
       let perms = detect_permissions(&content, has_scripts);
       (fm.name, fm.description, Some(h), fm.author, fm.license, fm.version, perms, true)
   } else {
       return None;
   };

    Some(ScanResult {
        name: parsed_name.unwrap_or_else(|| name.clone()),
        original_dir: name,
        source_lib: source_lib.to_string(),
        path: dir.to_string_lossy().to_string(),
        description: description.unwrap_or_default(),
        content_hash: hash.unwrap_or_default(),
        author: author.unwrap_or_default(),
        license: license.unwrap_or_default(),
        version: version.unwrap_or_default(),
        permissions,
        disabled,
    })
}

pub struct ScanResult {
    pub name: String,
    pub original_dir: String,
    pub source_lib: String,
    pub path: String,
    pub description: String,
    pub content_hash: String,
    pub author: String,
    pub license: String,
    pub version: String,
    pub permissions: Vec<String>,
    pub disabled: bool,
}

/// 扫描某个 runtime 目录下所有 skill，写入数据库。
/// id_prefix 决定 skill 的稳定 id（用 runtime id），label 仅用于展示（source_lib）。
/// 跳过 symlink：连接到其它 runtime 时建立的软链不算作独立 skill，避免重复登记。
pub fn scan_runtime_dir(conn: &Connection, id_prefix: &str, label: &str, source_path: &str) -> Vec<String> {
    let base = PathBuf::from(source_path);
    let mut found_ids = Vec::new();

    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return found_ids,
    };

    for entry in entries.flatten() {
         let path = entry.path();
         // 只扫描真实目录，跳过文件 / 隐藏目录 / symlink
         if !path.is_dir() || path.is_symlink() {
             continue;
         }
         let dir_name = path.file_name().unwrap().to_string_lossy().to_string();

         if dir_name.starts_with('.') {
            continue;
        }

        if let Some(scan) = scan_skill_dir(&path, label) {
            let id = format!("{}:{}", id_prefix, scan.original_dir);
            found_ids.push(id.clone());
           conn.execute(
                 "INSERT INTO skills (id, name, source_lib, path, description, content_hash, author, license, version, permissions, enabled, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                  ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, source_lib=excluded.source_lib, path=excluded.path,
                    description=excluded.description, content_hash=excluded.content_hash,
                    author=excluded.author, license=excluded.license, version=excluded.version,
                    permissions=excluded.permissions, updated_at=excluded.updated_at",
                params![
                     id,
                     scan.name,
                     scan.source_lib,
                     scan.path,
                     scan.description,
                     scan.content_hash,
                     scan.author,
                     scan.license,
                     scan.version,
                     serde_json::to_string(&scan.permissions).unwrap_or_else(|_| "[]".into()),
                     !scan.disabled as i32,
                     now_iso(),
                     now_iso(),
                 ],
             )
             .ok();

            // 初始化连接状态行（如果不存在）
            for agent in &db_enabled_agents(conn) {
                conn.execute(
                     "INSERT OR IGNORE INTO connections (skill_id, runtime, linked, updated_at) VALUES (?1, ?2, 0, ?3)",
                     params![id, agent.id, now_iso()],
                 )
                 .ok();
             }
         }
    }

    found_ids
}

/// 扫描库源目录下所有 skill，写入数据库。
/// id_prefix = library source id（如 "1"），label = 库源显示名（如 "主库"）。
/// skill id = <lib_id>:<dir_name>，source_lib = label。
/// 库源中的 symlink 是合法的 skill 入口（指向真实目录），需要跟随。
pub fn scan_library_source(conn: &Connection, id_prefix: &str, label: &str, source_path: &str) -> Vec<String> {
    let base = PathBuf::from(source_path);
    let mut found_ids = Vec::new();

    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return found_ids,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // is_dir() 跟随 symlink：symlink 指向目录时返回 true
        if !path.is_dir() {
            continue;
        }
        let dir_name = path.file_name().unwrap().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }

        if let Some(scan) = scan_skill_dir(&path, label) {
            let id = format!("{}:{}", id_prefix, scan.original_dir);
            found_ids.push(id.clone());
            conn.execute(
                "INSERT INTO skills (id, name, source_lib, path, description, content_hash, author, license, version, permissions, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name, source_lib=excluded.source_lib, path=excluded.path,
                   description=excluded.description, content_hash=excluded.content_hash,
                   author=excluded.author, license=excluded.license, version=excluded.version,
                   permissions=excluded.permissions, updated_at=excluded.updated_at",
                params![
                    id,
                    scan.name,
                    scan.source_lib,
                    scan.path,
                    scan.description,
                    scan.content_hash,
                    scan.author,
                    scan.license,
                    scan.version,
                    serde_json::to_string(&scan.permissions).unwrap_or_else(|_| "[]".into()),
                    !scan.disabled as i32,
                    now_iso(),
                    now_iso(),
                ],
            ).ok();

            // 初始化连接状态行（如果不存在）
            for agent in &db_enabled_agents(conn) {
                conn.execute(
                    "INSERT OR IGNORE INTO connections (skill_id, runtime, linked, updated_at) VALUES (?1, ?2, 0, ?3)",
                    params![id, agent.id, now_iso()],
                ).ok();
            }
        }
    }

    found_ids
}

/// 从数据库读取所有 skill 及其连接状态
pub fn get_all_skills(conn: &Connection) -> Vec<SkillRow> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.source_lib, s.path, s.description, s.content_hash, s.tags, s.enabled,
                    s.author, s.license, s.version, s.permissions,
                     GROUP_CONCAT(c.runtime) as linked_runtimes
              FROM skills s
              LEFT JOIN connections c ON s.id = c.skill_id AND c.linked = 1
              GROUP BY s.id
              ORDER BY s.name COLLATE NOCASE",
        )
        .expect("failed to prepare query");

    stmt.query_map([], |row| {
        let content_hash: String = row.get(5).unwrap_or_default();
        let tags_str: String = row.get(6).unwrap_or_else(|_| "[]".to_string());
        let enabled: bool = row.get::<_, i64>(7).unwrap_or(1) != 0;
        let author: String = row.get(8).unwrap_or_default();
        let license: String = row.get(9).unwrap_or_default();
        let version: String = row.get(10).unwrap_or_default();
        let perms_str: String = row.get(11).unwrap_or_else(|_| "[]".to_string());
        let permissions: Vec<String> = serde_json::from_str(&perms_str).unwrap_or_default();
        let tags: Vec<String> =
            serde_json::from_str(&tags_str).unwrap_or_default();
        let linked_str: String = row.get::<_, Option<String>>(12).unwrap_or(None).unwrap_or_default();
        let links: Vec<String> = if linked_str.is_empty() {
            vec![]
        } else {
            linked_str.split(',').map(|s| s.to_string()).collect()
        };
        Ok(SkillRow {
            id: row.get(0)?,
            name: row.get(1)?,
            source_lib: row.get(2)?,
            path: row.get(3)?,
            description: row.get(4).unwrap_or_default(),
            content_hash,
            tags,
            links,
            enabled,
            author,
            license,
            version,
            permissions,
        })
    })
    .expect("failed to query skills")
    .filter_map(|r| r.ok())
    .collect()
}
