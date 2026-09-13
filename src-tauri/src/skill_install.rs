use crate::db::{log_activity, now_iso, DbState, LibrarySourceRow};
use crate::scanner;
use crate::skill_audit::{self, AuditReport, AuditVerdict};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::State;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillSourceInput {
    /// "git" | "archive" | "path"
    pub kind: String,
    /// git URL / zip 文件路径 / 本地目录路径
    pub source_ref: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct InstallResult {
    /// installed | conflict | audit_blocked | audit_warned | up_to_date | local_changes | updated
    pub status: String,
    pub skill_id: Option<String>,
    pub skill_name: String,
    pub target_path: String,
    pub message: String,
    pub report: Option<AuditReport>,
}

#[derive(Serialize, Debug, Clone)]
pub struct UpdateAvailability {
    pub skill_id: String,
    pub skill_name: String,
    pub has_update: bool,
    pub local_changes: bool,
    pub error: Option<String>,
}

struct StagingGuard(PathBuf);

impl StagingGuard {
    fn new(label: &str) -> Self {
        let dir = staging_root().join(format!("{}-{}", label, Uuid::new_v4()));
        fs::create_dir_all(&dir).ok();
        StagingGuard(dir)
    }
}

impl Drop for StagingGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn staging_root() -> PathBuf {
    STAGING_ROOT.with(|root| root.borrow().clone()).unwrap_or_else(|| {
        crate::db::data_dir().join("staging")
    })
}

thread_local! {
    static STAGING_ROOT: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// 仅供测试：把暂存目录指到临时位置，避免读写真实应用数据目录。
#[cfg(test)]
pub(crate) fn set_staging_root(path: PathBuf) {
    STAGING_ROOT.with(|root| *root.borrow_mut() = Some(path));
}

/// 与 commands::resolve_library_path 相同的路径解析规则（~ / 相对 home / 绝对路径）
fn resolve_path(path: &str) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    if let Some(rest) = path.strip_prefix("~/") {
        return home.join(rest);
    }
    if path == "~" {
        return home;
    }
    if Path::new(path).is_absolute() {
        return PathBuf::from(path);
    }
    home.join(path)
}

fn has_manifest(dir: &Path) -> bool {
    dir.join("SKILL.md").is_file() || dir.join("SKILL.md.disabled").is_file()
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;
    let mut children: Vec<PathBuf> = fs::read_dir(src)
        .map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?
        .flatten()
        .map(|entry| entry.path())
        .collect();
    children.sort();
    for path in children {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string());
        let name = name.unwrap_or_default();
        if name == ".git" || name == "__pycache__" || name == ".DS_Store" {
            continue;
        }
        let target = dst.join(&name);
        // symlink 按 metadata（跟随链接）复制内容，避免在库内引入新的活动链接
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target)
                .map_err(|e| format!("复制文件失败 {}: {}", path.display(), e))?;
        }
    }
    Ok(())
}

/// 跨设备安全的移动：先尝试 rename，失败时退化为复制 + 删除源。
fn move_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    copy_dir(src, dst)?;
    fs::remove_dir_all(src).map_err(|e| format!("清理源目录失败 {}: {}", src.display(), e))?;
    Ok(())
}

fn validate_git_url(url: &str) -> Result<(), String> {
    if url.starts_with('-') {
        return Err("非法 git 地址".to_string());
    }
    let allowed = url.starts_with("https://")
        || url.starts_with("git@")
        || url.starts_with("ssh://")
        || url.starts_with("file://")
        || Path::new(url).is_absolute();
    if allowed {
        Ok(())
    } else {
        Err("git 地址必须以 https://、git@、ssh:// 或 file:// 开头".to_string())
    }
}

fn fetch_git(url: &str, dest: &Path) -> Result<(), String> {
    validate_git_url(url)?;
    let output = std::process::Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg("--")
        .arg(url)
        .arg(dest)
        .output()
        .map_err(|e| format!("无法执行 git（请确认已安装）: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git clone 失败: {}", stderr));
    }
    // .git 元数据不参与安装内容
    let _ = fs::remove_dir_all(dest.join(".git"));
    Ok(())
}

fn validate_zip_entry(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if path.is_absolute() {
        return Err(format!("压缩包包含绝对路径条目: {}", name));
    }
    let unsafe_component = path.components().any(|component| {
        matches!(component, Component::ParentDir | Component::Prefix(_))
    });
    if unsafe_component {
        return Err(format!("压缩包包含路径穿越条目: {}", name));
    }
    Ok(())
}

const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;

fn fetch_archive(zip_path: &str, dest: &Path) -> Result<(), String> {
    let path = resolve_path(zip_path);
    if !path.is_file() {
        return Err(format!("压缩包不存在: {}", zip_path));
    }
    let file = fs::File::open(&path).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩包失败: {}", e))?;

    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        validate_zip_entry(entry.name())?;
        if entry.is_symlink() {
            return Err(format!("压缩包包含 symlink 条目: {}", entry.name()));
        }
        total += entry.size();
        if total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            return Err("压缩包解压后超过 512MB 限制".to_string());
        }

        let relative = Path::new(entry.name()).to_path_buf();
        let out_path = dest.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let mut out = fs::File::create(&out_path)
                .map_err(|e| format!("写入文件失败 {}: {}", out_path.display(), e))?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("解压失败: {}", e))?;
        }
    }
    Ok(())
}

fn fetch_path(source_dir: &str, dest: &Path) -> Result<(), String> {
    let src = resolve_path(source_dir);
    if !src.is_dir() {
        return Err(format!("来源目录不存在: {}", source_dir));
    }
    copy_dir(&src, dest)
}

fn fetch_source(source: &SkillSourceInput, dest: &Path) -> Result<(), String> {
    match source.kind.as_str() {
        "git" => fetch_git(&source.source_ref, dest),
        "archive" => fetch_archive(&source.source_ref, dest),
        "path" => fetch_path(&source.source_ref, dest),
        other => Err(format!("不支持的来源类型: {}", other)),
    }
}

fn collect_manifest_dirs(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == ".git" {
            continue;
        }
        // manifest 所在目录视为完整 skill，不再继续下钻
        if has_manifest(&path) {
            out.push(path);
            continue;
        }
        collect_manifest_dirs(&path, depth + 1, out);
    }
}

/// 在 fetch 结果中定位唯一 skill 根目录（含 SKILL.md / SKILL.md.disabled）。
fn locate_skill_root(fetch_dir: &Path) -> Result<PathBuf, String> {
    if has_manifest(fetch_dir) {
        return Ok(fetch_dir.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    collect_manifest_dirs(fetch_dir, 0, &mut candidates);
    match candidates.len() {
        1 => Ok(candidates.pop().expect("candidates has exactly one item")),
        0 => Err("来源中未找到 SKILL.md（不支持空来源）".to_string()),
        n => Err(format!("来源包含 {} 个 skill，要求唯一", n)),
    }
}

fn derived_name(source: &SkillSourceInput) -> String {
    let raw = source.source_ref.trim_end_matches(['/', '\\']);
    let last = raw
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("skill");
    let stem = last
        .strip_suffix(".git")
        .or_else(|| last.strip_suffix(".zip"))
        .unwrap_or(last);
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
            c
        } else {
            '-'
        })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "skill".to_string()
    } else {
        cleaned
    }
}

fn skill_name_for(root: &Path, fetch_dir: &Path, source: &SkillSourceInput) -> String {
    // manifest 位于 fetch 根时，目录名是暂存目录名，改用来源推导（repo 名 / 目录名）
    if root != fetch_dir {
        root.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| derived_name(source))
    } else {
        derived_name(source)
    }
}

fn load_library_source(
    conn: &Connection,
    library_source_id: &str,
) -> Result<LibrarySourceRow, String> {
    conn.query_row(
        "SELECT id, name, path, enabled, sort_order FROM library_sources WHERE id = ?1",
        params![library_source_id],
        |row| {
            Ok(LibrarySourceRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
            })
        },
    )
    .map_err(|_| format!("库源不存在: {}", library_source_id))
}

fn gate_by_audit(report: &AuditReport, override_audit: bool) -> Option<&'static str> {
    if report.verdict == AuditVerdict::Pass || override_audit {
        return None;
    }
    match report.verdict {
        AuditVerdict::Block => Some("audit_blocked"),
        _ => Some("audit_warned"),
    }
}

fn find_installed_skill_id(conn: &Connection, path: &Path) -> Result<Option<String>, String> {
    let path_str = path.to_string_lossy().to_string();
    let mut stmt = conn
        .prepare("SELECT id FROM skills WHERE path = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    let id = stmt
        .query_map(params![path_str], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .next();
    Ok(id)
}

fn upsert_origin(
    conn: &Connection,
    skill_id: &str,
    origin_type: &str,
    origin_ref: &str,
    version: &str,
    hash: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO skill_origins (skill_id, origin_type, origin_ref, installed_version, installed_hash, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(skill_id) DO UPDATE SET
           origin_type = excluded.origin_type,
           origin_ref = excluded.origin_ref,
           installed_version = excluded.installed_version,
           installed_hash = excluded.installed_hash,
           updated_at = excluded.updated_at",
        params![skill_id, origin_type, origin_ref, version, hash, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 安装 ============

pub fn install_skill_impl(
    conn: &Connection,
    source: &SkillSourceInput,
    library_source_id: &str,
    override_audit: bool,
) -> Result<InstallResult, String> {
    let library = load_library_source(conn, library_source_id)?;
    if !library.enabled {
        return Err(format!("库源已停用: {}", library.name));
    }
    let library_dir = resolve_path(&library.path);
    fs::create_dir_all(&library_dir).map_err(|e| format!("创建库源目录失败: {}", e))?;

    let staging = StagingGuard::new("install");
    let fetch_dir = staging.0.join("fetch");
    fs::create_dir_all(&fetch_dir).map_err(|e| format!("创建暂存目录失败: {}", e))?;
    fetch_source(source, &fetch_dir)?;
    let root = locate_skill_root(&fetch_dir)?;
    let skill_name = skill_name_for(&root, &fetch_dir, source);
    let target = library_dir.join(&skill_name);

    let report = skill_audit::audit_dir(&root);
    if let Some(status) = gate_by_audit(&report, override_audit) {
        return Ok(InstallResult {
            status: status.to_string(),
            skill_id: None,
            skill_name,
            target_path: target.to_string_lossy().to_string(),
            message: if status == "audit_blocked" {
                "安全审查发现阻断级问题，默认拒绝安装".to_string()
            } else {
                "安全审查发现警告，需要确认后继续".to_string()
            },
            report: Some(report),
        });
    }

    if target.exists() {
        return Ok(InstallResult {
            status: "conflict".to_string(),
            skill_id: None,
            skill_name,
            target_path: target.to_string_lossy().to_string(),
            message: "库源中已存在同名 skill，不执行覆盖".to_string(),
            report: Some(report),
        });
    }

    move_dir(&root, &target).map_err(|e| {
        let _ = fs::remove_dir_all(&target);
        e
    })?;

    let installed_hash = scanner::directory_hash(&target);
    let scan = scanner::scan_skill_dir(&target, &library.name)
        .ok_or_else(|| "安装后未找到 SKILL.md".to_string())?;
    // 刷新该库源投影，拿到稳定 skill id
    scanner::scan_library_source(
        conn,
        &library.id,
        &library.name,
        &library_dir.to_string_lossy(),
    );
    let skill_id = find_installed_skill_id(conn, &target)?.ok_or_else(|| {
        format!("安装完成但未能登记 skill: {}", target.display())
    })?;

    upsert_origin(
        conn,
        &skill_id,
        &source.kind,
        &source.source_ref,
        &scan.version,
        &installed_hash,
    )?;
    // 安装时的审计结论直接进入缓存，详情面板无需重算
    skill_audit::cache_report(conn, &skill_id, &report, &installed_hash)?;

    log_activity(
        conn,
        "install_skill",
        &format!(
            "{} ({}) -> {}{}",
            skill_name,
            source.kind,
            library.name,
            if override_audit { " [override-audit]" } else { "" }
        ),
    );

    Ok(InstallResult {
        status: "installed".to_string(),
        skill_id: Some(skill_id),
        skill_name,
        target_path: target.to_string_lossy().to_string(),
        message: "安装完成".to_string(),
        report: Some(report),
    })
}

// ============ 更新 ============

fn source_directory_hash(source: &SkillSourceInput) -> Result<String, String> {
    if source.kind == "path" {
        let dir = resolve_path(&source.source_ref);
        if !dir.is_dir() {
            return Err(format!("来源目录不存在: {}", source.source_ref));
        }
        return Ok(scanner::directory_hash(&dir));
    }
    let staging = StagingGuard::new("check");
    let fetch_dir = staging.0.join("fetch");
    fs::create_dir_all(&fetch_dir).map_err(|e| format!("创建暂存目录失败: {}", e))?;
    fetch_source(source, &fetch_dir)?;
    let root = locate_skill_root(&fetch_dir)?;
    Ok(scanner::directory_hash(&root))
}

pub fn check_skill_updates_impl(
    conn: &Connection,
    skill_ids: &[String],
) -> Vec<UpdateAvailability> {
    skill_ids
        .iter()
        .map(|skill_id| {
            let row = conn.query_row(
                "SELECT s.name, s.path, o.origin_type, o.origin_ref, o.installed_hash
                 FROM skills s JOIN skill_origins o ON o.skill_id = s.id
                 WHERE s.id = ?1",
                params![skill_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            );
            let (name, path, origin_type, origin_ref, installed_hash) = match row {
                Ok(value) => value,
                Err(_) => {
                    return UpdateAvailability {
                        skill_id: skill_id.clone(),
                        skill_name: skill_id.clone(),
                        has_update: false,
                        local_changes: false,
                        error: Some("skill 不存在或未记录安装来源".to_string()),
                    };
                }
            };

            let source = SkillSourceInput {
                kind: origin_type,
                source_ref: origin_ref,
            };
            let latest_hash = source_directory_hash(&source);
            let local_hash = scanner::directory_hash(Path::new(&path));

            match latest_hash {
                Ok(latest) => UpdateAvailability {
                    skill_id: skill_id.clone(),
                    skill_name: name,
                    has_update: latest != installed_hash,
                    local_changes: local_hash != installed_hash,
                    error: None,
                },
                Err(error) => UpdateAvailability {
                    skill_id: skill_id.clone(),
                    skill_name: name,
                    has_update: false,
                    local_changes: local_hash != installed_hash,
                    error: Some(error),
                },
            }
        })
        .collect()
}

pub fn update_skill_impl(
    conn: &Connection,
    skill_id: &str,
    override_audit: bool,
    allow_local_changes: bool,
) -> Result<InstallResult, String> {
    let (name, path, origin_type, origin_ref, installed_hash) = conn
        .query_row(
            "SELECT s.name, s.path, o.origin_type, o.origin_ref, o.installed_hash
             FROM skills s JOIN skill_origins o ON o.skill_id = s.id
             WHERE s.id = ?1",
            params![skill_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| format!("skill 不存在或未记录安装来源: {}", skill_id))?;

    let source = SkillSourceInput {
        kind: origin_type.clone(),
        source_ref: origin_ref.clone(),
    };
    let staging = StagingGuard::new("update");
    let fetch_dir = staging.0.join("fetch");
    fs::create_dir_all(&fetch_dir).map_err(|e| format!("创建暂存目录失败: {}", e))?;
    fetch_source(&source, &fetch_dir)?;
    let root = locate_skill_root(&fetch_dir)?;
    let latest_hash = scanner::directory_hash(&root);

    if latest_hash == installed_hash {
        return Ok(InstallResult {
            status: "up_to_date".to_string(),
            skill_id: Some(skill_id.to_string()),
            skill_name: name,
            target_path: path.clone(),
            message: "已是最新版本".to_string(),
            report: None,
        });
    }

    let local_hash = scanner::directory_hash(Path::new(&path));
    if local_hash != installed_hash && !allow_local_changes {
        return Ok(InstallResult {
            status: "local_changes".to_string(),
            skill_id: Some(skill_id.to_string()),
            skill_name: name,
            target_path: path.clone(),
            message: "本地内容相对安装时已被修改，更新会覆盖这些改动".to_string(),
            report: None,
        });
    }

    let report = skill_audit::audit_dir(&root);
    if let Some(status) = gate_by_audit(&report, override_audit) {
        return Ok(InstallResult {
            status: status.to_string(),
            skill_id: Some(skill_id.to_string()),
            skill_name: name,
            target_path: path.clone(),
            message: if status == "audit_blocked" {
                "新版本安全审查发现阻断级问题，默认拒绝更新".to_string()
            } else {
                "新版本安全审查发现警告，需要确认后继续".to_string()
            },
            report: Some(report),
        });
    }

    // 事务性替换：旧目录先进暂存备份，新目录落盘；失败回滚
    let backup = staging.0.join("backup");
    move_dir(Path::new(&path), &backup)?;
    if let Err(error) = move_dir(&root, Path::new(&path)) {
        move_dir(&backup, Path::new(&path))
            .map_err(|restore_error| format!("更新失败且回滚失败：{} / {}", error, restore_error))?;
        return Err(format!("更新失败，已回滚: {}", error));
    }

    let scan = scanner::scan_skill_dir(Path::new(&path), "")
        .ok_or_else(|| "更新后未找到 SKILL.md".to_string())?;
    upsert_origin(
        conn,
        skill_id,
        &origin_type,
        &origin_ref,
        &scan.version,
        &latest_hash,
    )?;
    skill_audit::cache_report(conn, skill_id, &report, &latest_hash)?;

    let library_id = skill_id.split(':').next().unwrap_or_default().to_string();
    if let Ok(library) = load_library_source(conn, &library_id) {
        let library_dir = resolve_path(&library.path);
        scanner::scan_library_source(
            conn,
            &library.id,
            &library.name,
            &library_dir.to_string_lossy(),
        );
    }

    log_activity(
        conn,
        "update_skill",
        &format!(
            "{} ({}){}{}",
            name,
            origin_type,
            if allow_local_changes { " [keep-local-off]" } else { "" },
            if override_audit { " [override-audit]" } else { "" }
        ),
    );

    Ok(InstallResult {
        status: "updated".to_string(),
        skill_id: Some(skill_id.to_string()),
        skill_name: name,
        target_path: path,
        message: "更新完成".to_string(),
        report: Some(report),
    })
}

// ============ Tauri commands ============

#[tauri::command(async)]
pub fn install_skill(
    db: State<DbState>,
    source: SkillSourceInput,
    library_source_id: String,
    override_audit: bool,
) -> Result<InstallResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    install_skill_impl(&conn, &source, &library_source_id, override_audit)
}

#[tauri::command(async)]
pub fn update_skill(
    db: State<DbState>,
    skill_id: String,
    override_audit: bool,
    allow_local_changes: bool,
) -> Result<InstallResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    update_skill_impl(&conn, &skill_id, override_audit, allow_local_changes)
}

#[tauri::command(async)]
pub fn check_skill_updates(
    db: State<DbState>,
    skill_ids: Vec<String>,
) -> Result<Vec<UpdateAvailability>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(check_skill_updates_impl(&conn, &skill_ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_root() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "skill-deck-install-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn write_skill(dir: &Path, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {}\nversion: 1.0.0\n---\n说明\n", body),
        )
        .unwrap();
    }

    fn test_db(lib_dir: &Path) -> Connection {
        // 每个测试用独立 staging，避免互相污染，也避免写真实数据目录
        set_staging_root(lib_dir.parent().unwrap().join("staging"));
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, source_lib TEXT NOT NULL,
                path TEXT NOT NULL, description TEXT, tags TEXT DEFAULT '[]',
                content_hash TEXT, enabled INTEGER DEFAULT 1,
                author TEXT DEFAULT '', license TEXT DEFAULT '', version TEXT DEFAULT '',
                permissions TEXT DEFAULT '[]',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE connections (
                skill_id TEXT NOT NULL, runtime TEXT NOT NULL, linked INTEGER DEFAULT 0,
                symlink_path TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (skill_id, runtime)
             );
             CREATE TABLE agents (id TEXT PRIMARY KEY);
             CREATE TABLE skill_audits (
                id INTEGER PRIMARY KEY, skill_id TEXT NOT NULL, content_hash TEXT NOT NULL,
                verdict TEXT NOT NULL, findings TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
             );
             CREATE TABLE skill_origins (
                skill_id TEXT PRIMARY KEY, origin_type TEXT NOT NULL, origin_ref TEXT NOT NULL,
                installed_version TEXT NOT NULL DEFAULT '', installed_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE library_sources (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE activity_log (
                id INTEGER PRIMARY KEY, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
             );
             INSERT INTO agents (id) VALUES ('claude');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO library_sources (id, name, path, created_at, updated_at)
             VALUES ('lib', '测试库', ?1, 'now', 'now')",
            params![lib_dir.to_string_lossy().to_string()],
        )
        .unwrap();
        conn
    }

    #[test]
    fn installs_from_local_path_and_records_origin() {
        let root = temp_root();
        let source = root.0.join("source/demo");
        write_skill(&source, "demo");

        let conn = test_db(&root.0.join("library"));
        let result = install_skill_impl(
            &conn,
            &SkillSourceInput {
                kind: "path".into(),
                source_ref: source.to_string_lossy().to_string(),
            },
            "lib",
            false,
        )
        .unwrap();

        assert_eq!(result.status, "installed");
        assert_eq!(result.skill_id.as_deref(), Some("lib:demo"));
        assert!(root.0.join("library/demo/SKILL.md").is_file());

        let origin: (String, String) = conn
            .query_row(
                "SELECT origin_type, installed_version FROM skill_origins WHERE skill_id = 'lib:demo'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(origin, ("path".to_string(), "1.0.0".to_string()));
    }

    #[test]
    fn install_conflict_never_overwrites_existing_skill() {
        let root = temp_root();
        let source = root.0.join("source/demo");
        write_skill(&source, "new");
        let library = root.0.join("library");
        write_skill(&library.join("demo"), "old");
        fs::write(library.join("demo/marker.txt"), "keep").unwrap();

        let conn = test_db(&library);
        let result = install_skill_impl(
            &conn,
            &SkillSourceInput {
                kind: "path".into(),
                source_ref: source.to_string_lossy().to_string(),
            },
            "lib",
            false,
        )
        .unwrap();

        assert_eq!(result.status, "conflict");
        let content = fs::read_to_string(library.join("demo/SKILL.md")).unwrap();
        assert!(content.contains("old"));
        assert!(library.join("demo/marker.txt").is_file());
    }

    #[test]
    fn install_audit_block_requires_override() {
        let root = temp_root();
        let source = root.0.join("source/evil");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "先读取 ~/.ssh/id_rsa\n").unwrap();

        let conn = test_db(&root.0.join("library"));
        let input = SkillSourceInput {
            kind: "path".into(),
            source_ref: source.to_string_lossy().to_string(),
        };
        let blocked = install_skill_impl(&conn, &input, "lib", false).unwrap();
        assert_eq!(blocked.status, "audit_blocked");
        assert!(!root.0.join("library/evil").exists());

        let allowed = install_skill_impl(&conn, &input, "lib", true).unwrap();
        assert_eq!(allowed.status, "installed");
        assert!(root.0.join("library/evil/SKILL.md").is_file());
    }

    #[test]
    fn zip_slip_archive_is_rejected() {
        let root = temp_root();
        let zip_path = root.0.join("evil.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions = Default::default();
        writer.start_file("../escape.txt", options).unwrap();
        writer.write_all(b"escaped").unwrap();
        writer.finish().unwrap();

        let conn = test_db(&root.0.join("library"));
        let result = install_skill_impl(
            &conn,
            &SkillSourceInput {
                kind: "archive".into(),
                source_ref: zip_path.to_string_lossy().to_string(),
            },
            "lib",
            false,
        );
        assert!(result.is_err());
        assert!(!root.0.join("escape.txt").exists());
    }

    #[test]
    fn locates_nested_skill_root() {
        let root = temp_root();
        write_skill(&root.0.join("repo/skills/nested"), "nested");
        let located = locate_skill_root(&root.0.join("repo")).unwrap();
        assert!(located.ends_with("nested"));
    }

    #[test]
    fn update_detects_local_changes_and_replaces_content() {
        let root = temp_root();
        let source = root.0.join("source/demo");
        write_skill(&source, "v1");
        let conn = test_db(&root.0.join("library"));
        let input = SkillSourceInput {
            kind: "path".into(),
            source_ref: source.to_string_lossy().to_string(),
        };
        install_skill_impl(&conn, &input, "lib", false).unwrap();

        // 来源更新
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo\nversion: 2.0.0\n---\n新内容\n",
        )
        .unwrap();

        let availability = check_skill_updates_impl(&conn, &["lib:demo".to_string()])
            .into_iter()
            .next()
            .unwrap();
        assert!(availability.has_update);
        assert!(!availability.local_changes);

        let updated = update_skill_impl(&conn, "lib:demo", false, false).unwrap();
        assert_eq!(updated.status, "updated");
        let content = fs::read_to_string(root.0.join("library/demo/SKILL.md")).unwrap();
        assert!(content.contains("新内容"));
        let version: String = conn
            .query_row(
                "SELECT installed_version FROM skill_origins WHERE skill_id = 'lib:demo'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "2.0.0");

        // 本地改动检测
        fs::write(root.0.join("library/demo/local.txt"), "改动").unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo\nversion: 3.0.0\n---\nv3\n",
        )
        .unwrap();
        let gated = update_skill_impl(&conn, "lib:demo", false, false).unwrap();
        assert_eq!(gated.status, "local_changes");
        assert!(root.0.join("library/demo/local.txt").is_file());

        let forced = update_skill_impl(&conn, "lib:demo", false, true).unwrap();
        assert_eq!(forced.status, "updated");
        assert!(!root.0.join("library/demo/local.txt").exists());
    }
}
