use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

/// All runtimes the app manages. Add new runtimes here.
pub const RUNTIMES: &[RuntimeConfig] = &[
    RuntimeConfig { id: "claude", label: "Claude", dir: ".claude/skills", color: "orange", auto_scan: false },
    RuntimeConfig { id: "codex", label: "Codex", dir: ".agents/skills", color: "green", auto_scan: true },
    RuntimeConfig { id: "trae", label: "Trae", dir: ".trae-cn/skills", color: "blue", auto_scan: false },
    RuntimeConfig { id: "workbuddy", label: "WorkBuddy", dir: ".workbuddy/skills", color: "violet", auto_scan: false },
];

pub struct RuntimeConfig {
    pub id: &'static str,
    pub label: &'static str,
    pub dir: &'static str,
    pub color: &'static str,
    pub auto_scan: bool,
}

pub fn runtime_ids() -> Vec<&'static str> {
    RUNTIMES.iter().map(|r| r.id).collect()
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("skilldeck")
}

pub fn db_path() -> PathBuf {
    data_dir().join("skilldeck.db")
}

fn migrate_legacy_database(db_path: &PathBuf) {
    if db_path.exists() {
        return;
    }

    let legacy_db = dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("ai-hub")
        .join("ai-hub.db");
    if !legacy_db.exists() {
        return;
    }

    std::fs::create_dir_all(db_path.parent().unwrap())
        .expect("failed to create SkillDeck data directory");
    std::fs::copy(&legacy_db, db_path).expect("failed to migrate legacy ai-hub database");
}

pub fn open() -> Connection {
     let db_path = db_path();
     migrate_legacy_database(&db_path);
     std::fs::create_dir_all(db_path.parent().unwrap()).ok();
     let conn = Connection::open(db_path).expect("failed to open db");
     migrate(&conn);
     conn
 }

 fn migrate(conn: &Connection) {
     conn.execute_batch(
         r#"
        CREATE TABLE IF NOT EXISTS skills (
             id           TEXT PRIMARY KEY,
             name         TEXT NOT NULL,
             source_lib   TEXT NOT NULL,
             path         TEXT NOT NULL,
             description  TEXT,
             tags         TEXT DEFAULT '[]',
             content_hash TEXT,
             created_at   TEXT NOT NULL,
             updated_at   TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS connections (
             skill_id     TEXT NOT NULL,
             runtime      TEXT NOT NULL,
             linked       INTEGER DEFAULT 0,
             symlink_path TEXT,
             updated_at   TEXT NOT NULL,
             PRIMARY KEY (skill_id, runtime),
             FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
         );

        CREATE TABLE IF NOT EXISTS presets (
            id          INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            skill_ids   TEXT DEFAULT '[]',
            runtime     TEXT DEFAULT 'claude',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompts (
            id          INTEGER PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            tags        TEXT DEFAULT '[]',
            source      TEXT DEFAULT 'manual',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rules (
            id          INTEGER PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            platform    TEXT DEFAULT 'claude',
            target_path TEXT,
            tags        TEXT DEFAULT '[]',
            source      TEXT DEFAULT 'manual',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_log (
             id         INTEGER PRIMARY KEY,
             action     TEXT NOT NULL,
             detail     TEXT,
             created_at TEXT NOT NULL
         );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

       -- 扩展 (Extension): MCP / Hook / Plugin 统一管理，参考 HarnessKit extension 模型
        CREATE TABLE IF NOT EXISTS extensions (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL,           -- 'mcp' | 'hook' | 'plugin'
            runtime     TEXT NOT NULL,           -- 'claude' | 'codex'
            name        TEXT NOT NULL,           -- mcp: server名; hook: event; plugin: name@market
            config_json TEXT NOT NULL DEFAULT '{}',
            enabled     INTEGER NOT NULL DEFAULT 1,
            description TEXT NOT NULL DEFAULT '',
            source      TEXT NOT NULL DEFAULT 'scan',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

       -- 工具集 (Package): 可移植的 AI 能力包，对齐 ai-package-spec-v0.1
       CREATE TABLE IF NOT EXISTS packages (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL DEFAULT '',
            version      TEXT NOT NULL DEFAULT '0.1.0',
            description  TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS package_skills (
            package_id  TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
            position    INTEGER NOT NULL DEFAULT 0,
            name        TEXT NOT NULL,
            skill_id    TEXT,
            source_path TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (package_id, name)
        );

        CREATE TABLE IF NOT EXISTS package_mcps (
            package_id  TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
            position    INTEGER NOT NULL DEFAULT 0,
            name        TEXT NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (package_id, name)
        );

       CREATE TABLE IF NOT EXISTS package_configs (
           package_id  TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
           position    INTEGER NOT NULL DEFAULT 0,
           agent       TEXT NOT NULL,
           category    TEXT NOT NULL DEFAULT 'rules',
           file_name   TEXT NOT NULL,
           content     TEXT NOT NULL DEFAULT '',
           PRIMARY KEY (package_id, agent, file_name)
       );

      -- Agent 注册表：替代硬编码 RUNTIMES，用户可增删改
      CREATE TABLE IF NOT EXISTS agents (
          id              TEXT PRIMARY KEY,
          label           TEXT NOT NULL,
          skills_dir      TEXT NOT NULL,
          config_dir      TEXT NOT NULL,
          mcp_config_file TEXT NOT NULL DEFAULT '',
         color           TEXT NOT NULL DEFAULT 'slate',
         auto_scan       INTEGER NOT NULL DEFAULT 0,
         scan_agents_dir INTEGER NOT NULL DEFAULT 0,
         enabled         INTEGER NOT NULL DEFAULT 1,
         sort_order      INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
      );

       -- 项目注册表：与全局 Agent 对应，管理项目级的 skills/rules 配置
       CREATE TABLE IF NOT EXISTS projects (
           id          TEXT PRIMARY KEY,
           name        TEXT NOT NULL,
           path        TEXT NOT NULL,
           color       TEXT NOT NULL DEFAULT 'slate',
           sort_order  INTEGER NOT NULL DEFAULT 0,
           created_at  TEXT NOT NULL,
           updated_at  TEXT NOT NULL
       );

      -- 库源 (Library Source): skill 来源目录，与 agent 分离
      -- skill 从库源发现，通过 symlink 接入各 agent 的 skills 目录
      CREATE TABLE IF NOT EXISTS library_sources (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          path        TEXT NOT NULL,
          enabled     INTEGER NOT NULL DEFAULT 1,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
      );
       "#,
   )
   .expect("failed to migrate db");

    // Migration: fix library_sources schema if created by older app version
    // Old schema had INTEGER id + no sort_order/updated_at columns
    {
        let needs_recreate: bool = {
            let cols: Vec<String> = conn
                .prepare("PRAGMA table_info(library_sources)")
                .ok()
                .map(|mut s| {
                    s.query_map([], |r| r.get::<_, String>(1))
                        .ok()
                        .map(|rows| rows.filter_map(|r| r.ok()).collect())
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            !cols.iter().any(|c| c == "sort_order")
        };
        if needs_recreate {
            conn.execute("DROP TABLE library_sources", []).ok();
            conn.execute(
                "CREATE TABLE library_sources (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    path        TEXT NOT NULL,
                    enabled     INTEGER NOT NULL DEFAULT 1,
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                )",
                [],
            ).ok();
        }
    }

   // Migration: codex 从 auto-scan 源目录改为独立 symlink 目录
   // Note: seed 已修正为 .codex/skills，此迁移仅兼容旧版数据库
   conn.execute(
       "UPDATE agents SET skills_dir = '.codex/skills', auto_scan = 0 WHERE id = 'codex' AND skills_dir = '.agents/skills'",
       [],
   ).ok();

   // Migration: 添加 scan_agents_dir 列
   {
       let cols: Vec<String> = conn
           .prepare("PRAGMA table_info(agents)")
           .ok()
           .map(|mut s| {
               s.query_map([], |r| r.get::<_, String>(1))
                   .ok()
                   .map(|rows| rows.filter_map(|r| r.ok()).collect())
                   .unwrap_or_default()
           })
           .unwrap_or_default();
       if !cols.iter().any(|c| c == "scan_agents_dir") {
           conn.execute(
               "ALTER TABLE agents ADD COLUMN scan_agents_dir INTEGER NOT NULL DEFAULT 0",
               [],
           ).ok();
       }
   }

   // Migration: 已知会扫描 .agents/skills 的 agent 默认开启
   conn.execute(
       "UPDATE agents SET scan_agents_dir = 1 WHERE id IN ('codex', 'cursor', 'opencode') AND scan_agents_dir = 0",
       [],
   ).ok();

   // Migration: skill id 前缀 codex: -> main: (库源模式后 source 是 library_sources)
    {
        let renamed = conn.execute(
            "UPDATE skills SET id = 'main:' || substr(id, 7) WHERE id LIKE 'codex:%'",
            [],
        ).unwrap_or(0);
        if renamed > 0 {
            conn.execute(
                "UPDATE connections SET skill_id = 'main:' || substr(skill_id, 7) WHERE skill_id LIKE 'codex:%'",
                [],
            ).ok();
            conn.execute(
                "UPDATE presets SET skill_ids = REPLACE(skill_ids, 'codex:', 'main:') WHERE skill_ids LIKE '%codex:%'",
                [],
            ).ok();
        }
    }

    // Preserve legacy library paths while new installs default to .skilldeck/skills.
    {
        let home = dirs::home_dir().unwrap_or_default();
        let old_abs = home.join(".agents/skills").to_string_lossy().to_string();
        conn.execute(
            "UPDATE library_sources SET path = '.ai-hub/skills'
             WHERE path IN ('.agents/skills', ?1)",
            params![&old_abs],
        ).ok();

        let new_prefix = home.join(".ai-hub/skills").to_string_lossy().to_string();
        conn.execute(
            "UPDATE skills SET path = REPLACE(path, ?1, ?2) WHERE path LIKE ?3",
            params![&old_abs, &new_prefix, format!("{}%", old_abs)],
        ).ok();
    }

    // Seed default library sources if table is empty
    {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library_sources", [], |r| r.get(0))
            .unwrap_or(0);
        if count == 0 {
            conn.execute(
                "INSERT INTO library_sources (id, name, path, enabled, sort_order, created_at, updated_at)
                 VALUES ('main', '主库', '.skilldeck/skills', 1, 0, ?1, ?1)",
                params![now_iso()],
            ).ok();
        }
    }

    // Seed default agents if table is empty
    {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0))
 .unwrap_or(0);
        if count == 0 {
            let defaults = [
               ("claude",    "Claude",    ".claude/skills",     ".claude",     ".claude.json",        "orange", 0, 0, 1, 0),
               ("codex",     "Codex",     ".codex/skills",      ".codex",      "config.toml",         "green",  0, 1, 1, 1),
               ("trae",      "Trae",      ".trae-cn/skills",    ".trae-cn",    "mcp.json",            "blue",   0, 0, 1, 2),
               ("workbuddy", "WorkBuddy", ".workbuddy/skills",  ".workbuddy",  "mcp.json",            "violet", 0, 0, 1, 3),
           ];
           for (id, label, sdir, cdir, mcp, color, auto, scan_ag, en, ord) in defaults {
               conn.execute(
                   "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color, auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
                    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                   params![id, label, sdir, cdir, mcp, color, auto, scan_ag, en, ord, now_iso()],
               ).ok();
            }
        }
    }

    // Migration: add `enabled` column to skills table
    {
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(skills)")
            .ok()
            .map(|mut s| {
                s.query_map([], |r| r.get::<_, String>(1))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        if !cols.iter().any(|c| c == "enabled") {
            conn.execute(
                "ALTER TABLE skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .ok();
        }
        if !cols.iter().any(|c| c == "author") {
            conn.execute("ALTER TABLE skills ADD COLUMN author TEXT NOT NULL DEFAULT ''", []).ok();
        }
        if !cols.iter().any(|c| c == "license") {
            conn.execute("ALTER TABLE skills ADD COLUMN license TEXT NOT NULL DEFAULT ''", []).ok();
        }
        if !cols.iter().any(|c| c == "version") {
            conn.execute("ALTER TABLE skills ADD COLUMN version TEXT NOT NULL DEFAULT ''", []).ok();
        }
        if !cols.iter().any(|c| c == "permissions") {
            conn.execute("ALTER TABLE skills ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'", []).ok();
        }
    }

    // Migration: old presets table used skill_names column
    let has_skill_names: bool = {
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(presets)")
            .ok()
            .map(|mut s| {
                s.query_map([], |r| r.get::<_, String>(1))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        cols.iter().any(|c| c == "skill_names")
    };

    if has_skill_names {
       conn.execute("DROP TABLE presets", []).ok();
       conn.execute(
           "CREATE TABLE presets (
               id INTEGER PRIMARY KEY, name TEXT NOT NULL,
               skill_ids TEXT DEFAULT '[]', runtime TEXT DEFAULT 'claude',
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL
           )",
           [],
       )
       .ok();
   }

    // 库源已移除：旧 skill id 前缀 主库: → 改为 codex:（.agents/skills 即 codex 目录）
    conn.execute(
        "UPDATE presets SET skill_ids = REPLACE(skill_ids, '主库:', 'codex:') WHERE skill_ids LIKE '%主库:%'",
        [],
    ).ok();

  // Enable FK cascade for package tables (rusqlite needs pragma per connection)
  conn.execute_batch("PRAGMA foreign_keys = ON;").ok();
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub source_lib: String,
    pub path: String,
    pub description: String,
    pub content_hash: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub enabled: bool,
    pub author: String,
    pub license: String,
    pub version: String,
    pub permissions: Vec<String>,
}

 #[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActivityLog {
    pub id: i64,
    pub action: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PromptRow {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub source: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleRow {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub platform: String,
    pub target_path: Option<String>,
    pub tags: Vec<String>,
    pub source: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuntimeInfo {
    pub id: String,
    pub label: String,
    pub color: String,
    pub default_dir: String,
    pub auto_scan: bool,
    pub scan_agents_dir: bool,
    pub config_dir: String,
    pub mcp_config_file: String,
    pub enabled: bool,
    pub sort_order: i64,
}


// ===================== Agent (运行环境注册表) =====================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentRow {
    pub id: String,
    pub label: String,
    pub skills_dir: String,
    pub config_dir: String,
    pub mcp_config_file: String,
   pub color: String,
   pub auto_scan: bool,
   pub scan_agents_dir: bool,
   pub enabled: bool,
   pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub sort_order: i64,
    pub skill_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Read all agents from DB, ordered by sort_order. Falls back to
/// the hardcoded RUNTIMES if the agents table is somehow empty.
pub fn db_agents(conn: &Connection) -> Vec<AgentRow> {
    let mut stmt = match conn.prepare(
      "SELECT id, label, skills_dir, config_dir, mcp_config_file, color,
              auto_scan, scan_agents_dir, enabled, sort_order
       FROM agents ORDER BY label COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map([], |row| {
        Ok(AgentRow {
            id: row.get(0)?,
            label: row.get(1)?,
            skills_dir: row.get(2)?,
            config_dir: row.get(3)?,
            mcp_config_file: row.get(4)?,
            color: row.get(5)?,
           auto_scan: row.get::<_, i64>(6)? != 0,
           scan_agents_dir: row.get::<_, i64>(7)? != 0,
           enabled: row.get::<_, i64>(8)? != 0,
           sort_order: row.get(9)?,
       })
    });
    rows.ok()
        .map(|r| r.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
}

/// Read only enabled agents from DB.
pub fn db_enabled_agents(conn: &Connection) -> Vec<AgentRow> {
    db_agents(conn).into_iter().filter(|a| a.enabled).collect()
}

// ===================== Library Source (库源) =====================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LibrarySourceRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub enabled: bool,
    pub sort_order: i64,
}

/// Read all library sources from DB, ordered by sort_order.
pub fn db_library_sources(conn: &Connection) -> Vec<LibrarySourceRow> {
    let mut stmt = match conn.prepare(
        "SELECT id, name, path, enabled, sort_order
         FROM library_sources ORDER BY sort_order, name COLLATE NOCASE",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map([], |row| {
        Ok(LibrarySourceRow {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            enabled: row.get::<_, i64>(3)? != 0,
            sort_order: row.get(4)?,
        })
    });
    rows.ok()
        .map(|r| r.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
}

/// Read only enabled library sources from DB.
pub fn db_enabled_library_sources(conn: &Connection) -> Vec<LibrarySourceRow> {
    db_library_sources(conn).into_iter().filter(|s| s.enabled).collect()
}


// ===================== Package (工具集 / AI 能力包) =====================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageRow {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub skill_count: i64,
    pub mcp_count: i64,
    pub config_count: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageSkillEntry {
    pub name: String,
    pub skill_id: Option<String>,
    pub source_path: String,
    pub position: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageMcpEntry {
    pub name: String,
    pub config_json: String,
    pub position: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageConfigEntry {
    pub agent: String,
    pub category: String,
    pub file_name: String,
    pub content: String,
    pub position: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageDetail {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub skills: Vec<PackageSkillEntry>,
    pub mcps: Vec<PackageMcpEntry>,
    pub configs: Vec<PackageConfigEntry>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PackageConfigInput {
    pub agent: String,
    pub category: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PackageMcpInput {
    pub name: String,
    pub config_json: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PackageSkillInput {
    pub name: String,
    pub skill_id: Option<String>,
    pub source_path: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PackageInput {
    pub name: String,
    pub display_name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub skills: Vec<PackageSkillInput>,
    pub mcps: Vec<PackageMcpInput>,
    pub configs: Vec<PackageConfigInput>,
}

// ===================== Extension (MCP / Hook / Plugin) =====================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtensionRow {
    pub id: String,
    pub kind: String,
    pub runtime: String,
    pub name: String,
    pub config_json: String,
    pub enabled: bool,
    pub description: String,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct McpServerInput {
    pub runtime: String,
    pub name: String,
    pub config_json: String,
    pub old_name: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct HookInput {
    pub runtime: String,
    pub event: String,
    pub matcher: String,
    pub command: String,
    pub timeout: i64,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PluginToggleInput {
    pub name: String,       // "browser@openai-bundled"
    pub marketplace: String,
    pub enabled: bool,
}

pub fn now_iso() -> String {
     use std::time::{SystemTime, UNIX_EPOCH};
     let secs = SystemTime::now()
         .duration_since(UNIX_EPOCH)
         .unwrap()
         .as_secs();
     format!("{}", secs)
 }

 pub fn log_activity(conn: &Connection, action: &str, detail: &str) {
     conn.execute(
         "INSERT INTO activity_log (action, detail, created_at) VALUES (?1, ?2, ?3)",
         params![action, detail, now_iso()],
     )
     .ok();
 }
