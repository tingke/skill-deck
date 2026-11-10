//! Agent Registry: 所有已知 Agent 的唯一定义处。
//!
//! 添加新 Agent 的步骤：
//! 1. 在 `SPECS` 中加一个 `AgentSpec`（含能力声明）。
//! 2. 需要进入 agents 表作为默认项的，把 `seeded` 设为 true（老库会通过 seed_agents 增量补齐）。
//! 3. 前端如需品牌图标，在 `src/components/AgentGlyph.tsx` 的 `BRAND_ICONS` 补充；
//!    缺省回退为首字母占位，颜色回退为 slate。
//!
//! 业务代码应通过能力字段（capabilities）判断行为，而不是 match agent id。

use rusqlite::params;

/// MCP 配置文件格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpFormat {
    /// Claude 用户级配置：JSON 顶层 `mcpServers`，位于 `~/.claude.json`。
    ClaudeJson,
    /// Codex 用户级配置：TOML 顶层 `mcp_servers`。
    CodexToml,
    /// 通用 JSON 形态：`{ "mcpServers": {} }`。
    JsonServers,
}

impl McpFormat {
    /// 序列化到 agents 表 capabilities 列的名字。
    pub fn as_str(self) -> &'static str {
        match self {
            McpFormat::ClaudeJson => "claude_json",
            McpFormat::CodexToml => "codex_toml",
            McpFormat::JsonServers => "json_servers",
        }
    }

    pub fn from_str(value: &str) -> Option<McpFormat> {
        match value {
            "claude_json" => Some(McpFormat::ClaudeJson),
            "codex_toml" => Some(McpFormat::CodexToml),
            "json_servers" => Some(McpFormat::JsonServers),
            _ => None,
        }
    }
}

/// Hooks 配置位置。`hooks = true` 的能力由存在此映射表达。
#[derive(Debug, Clone, Copy)]
pub struct HooksConfig {
    /// 相对 home 的 hook 配置文件路径，如 ".claude/settings.json"。
    pub file: &'static str,
    /// 该 agent 是否需要在别的配置里打开 feature flag（codex config.toml features.hooks）。
    pub requires_feature_flag: bool,
}

/// 单个 Agent 的能力声明。`None` 表示不支持对应扩展类型。
#[derive(Debug, Clone, Copy)]
pub struct Capabilities {
    /// 支持通过 symlink 接入 skills 目录。
    pub skills: bool,
    /// MCP 配置格式；None 表示不支持 MCP。
    pub mcp: Option<McpFormat>,
    /// Hooks 配置位置；None 表示不支持 Hooks。
    pub hooks: Option<HooksConfig>,
    /// 支持 Plugins。
    pub plugins: bool,
    /// 项目 Rules 目标文件名；None 表示未知，回退到通用 CLAUDE.md/AGENTS.md。
    pub rules: Option<&'static [&'static str]>,
    /// 支持挂活动监听 hook（activity 观察者）。
    pub activity: bool,
    /// 内置 Agent，不允许用户删除。
    pub builtin: bool,
}

/// 单个 Agent 的完整定义。
#[derive(Debug, Clone, Copy)]
pub struct AgentSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub color: &'static str,
    pub skills_dir: &'static str,
    pub config_dir: &'static str,
    pub mcp_config_file: &'static str,
    pub sort_order: i64,
    pub auto_scan: bool,
    pub scan_agents_dir: bool,
    /// 是否 seed 进 agents 表作为默认项。
    pub seeded: bool,
    /// 项目内识别标记（目录或文件名），用于从项目结构发现未注册 Agent。
    pub project_markers: &'static [&'static str],
    pub capabilities: Capabilities,
}

impl AgentSpec {
    pub fn capabilities_json(&self) -> String {
        let mut parts: Vec<String> = vec![format!("\"skills\":{}", self.capabilities.skills)];
        parts.push(match self.capabilities.mcp {
            Some(format) => format!("\"mcp\":\"{}\"", format.as_str()),
            None => "\"mcp\":null".to_string(),
        });
        parts.push(format!(
            "\"hooks\":{}",
            self.capabilities.hooks.is_some()
        ));
        parts.push(format!("\"plugins\":{}", self.capabilities.plugins));
        match self.capabilities.rules {
            Some(files) => {
                let list: Vec<String> = files.iter().map(|f| format!("\"{f}\"")).collect();
                parts.push(format!("\"rules\":[{}]", list.join(",")));
            }
            None => parts.push("\"rules\":null".to_string()),
        }
        parts.push(format!("\"activity\":{}", self.capabilities.activity));
        parts.push(format!("\"builtin\":{}", self.capabilities.builtin));
        format!("{{{}}}", parts.join(","))
    }
}

/// 所有已知 Agent。新增 Agent 在这里加条目。
pub const SPECS: &[AgentSpec] = &[
    AgentSpec {
        id: "claude",
        label: "Claude",
        color: "orange",
        skills_dir: ".claude/skills",
        config_dir: ".claude",
        mcp_config_file: ".claude.json",
        sort_order: 0,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: true,
        project_markers: &[".claude", "CLAUDE.md", ".claude.json"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::ClaudeJson),
            hooks: Some(HooksConfig { file: ".claude/settings.json", requires_feature_flag: false }),
            plugins: false,
            rules: Some(&["CLAUDE.md"]),
            activity: true,
            builtin: true,
        },
    },
    AgentSpec {
        id: "codex",
        label: "Codex",
        color: "green",
        skills_dir: ".codex/skills",
        config_dir: ".codex",
        mcp_config_file: "config.toml",
        sort_order: 1,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: true,
        project_markers: &[".codex", "AGENTS.md"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::CodexToml),
            hooks: Some(HooksConfig { file: ".codex/hooks.json", requires_feature_flag: true }),
            plugins: true,
            rules: Some(&["AGENTS.md"]),
            activity: true,
            builtin: true,
        },
    },
    AgentSpec {
        id: "trae",
        label: "Trae",
        color: "blue",
        skills_dir: ".trae-cn/skills",
        config_dir: ".trae-cn",
        mcp_config_file: "mcp.json",
        sort_order: 2,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: true,
        project_markers: &[".trae", ".trae-cn"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&[".trae/rules/project_rules.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "workbuddy",
        label: "WorkBuddy",
        color: "violet",
        skills_dir: ".workbuddy/skills",
        config_dir: ".workbuddy",
        mcp_config_file: "mcp.json",
        sort_order: 3,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: true,
        project_markers: &[".workbuddy"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            // 保留旧行为：workbuddy 项目 rules 回退到通用文件名。
            rules: None,
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "cursor",
        label: "Cursor",
        color: "slate",
        skills_dir: ".cursor/skills",
        config_dir: ".cursor",
        mcp_config_file: ".cursor/mcp.json",
        sort_order: 4,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: false,
        project_markers: &[".cursor", ".cursorrules"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&[".cursorrules"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "gemini",
        label: "Gemini",
        color: "sky",
        skills_dir: ".gemini/skills",
        config_dir: ".gemini",
        mcp_config_file: "settings.json",
        sort_order: 5,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".gemini", "GEMINI.md"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&["GEMINI.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "windsurf",
        label: "Windsurf",
        color: "teal",
        skills_dir: ".windsurf/skills",
        config_dir: ".windsurf",
        mcp_config_file: "mcp.json",
        sort_order: 6,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".windsurf", ".windsurfrules"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&[".windsurfrules"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "opencode",
        label: "OpenCode",
        color: "amber",
        skills_dir: ".opencode/skills",
        config_dir: ".opencode",
        mcp_config_file: "opencode.json",
        sort_order: 7,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: false,
        project_markers: &[".opencode", "opencode.json"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: None,
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "dsh",
        label: "DeepSeek Harness",
        color: "blue",
        skills_dir: ".dsh/skills",
        config_dir: ".dsh",
        // DSH 的 MCP 由 profile 内 cordis.patch.yml 的插件条目配置，
        // 不是简单的 mcp.json 形态，因此 mcp 能力为 None；该文件名仅作定位提示。
        mcp_config_file: "cordis.patch.yml",
        sort_order: 8,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: true,
        project_markers: &[".dsh"],
        capabilities: Capabilities {
            skills: true,
            mcp: None,
            hooks: None,
            plugins: false,
            rules: Some(&["AGENTS.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "iflow",
        label: "iFlow",
        color: "cyan",
        skills_dir: ".iflow/skills",
        config_dir: ".iflow",
        mcp_config_file: "mcp.json",
        sort_order: 9,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".iflow"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: None,
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "qwen",
        label: "Qwen Code",
        color: "purple",
        skills_dir: ".qwen/skills",
        config_dir: ".qwen",
        mcp_config_file: "settings.json",
        sort_order: 10,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".qwen", "QWEN.md"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&["QWEN.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "copilot",
        label: "Copilot CLI",
        color: "indigo",
        skills_dir: ".copilot/skills",
        config_dir: ".copilot",
        mcp_config_file: "mcp-config.json",
        sort_order: 11,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".copilot", ".github"],
        capabilities: Capabilities {
            skills: true,
            mcp: Some(McpFormat::JsonServers),
            hooks: None,
            plugins: false,
            rules: Some(&["AGENTS.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "zed",
        label: "Zed",
        color: "yellow",
        // Zed 不使用 .zed/skills：个人技能目录就是共享的 ~/.agents/skills
        // （见 zed.dev/docs/ai/skills），因此直接指向共享目录并开启 scan_agents_dir。
        skills_dir: ".agents/skills",
        config_dir: ".zed",
        mcp_config_file: "settings.json",
        sort_order: 12,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: false,
        project_markers: &[".zed", ".rules"],
        capabilities: Capabilities {
            skills: true,
            // Zed 的 MCP 是 settings.json 内 context_servers 形态，与 mcpServers 不同，暂不写入
            mcp: None,
            hooks: None,
            plugins: false,
            rules: Some(&[".rules"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "zcode",
        label: "ZCode",
        color: "emerald",
        skills_dir: ".zcode/skills",
        config_dir: ".zcode",
        mcp_config_file: "mcp.json",
        sort_order: 13,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".zcode"],
        capabilities: Capabilities {
            skills: true,
            mcp: None,
            hooks: None,
            plugins: true,
            rules: Some(&["AGENTS.md"]),
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "qoder",
        label: "Qoder",
        color: "amber",
        // Qoder 与 Zed 一样发现共享的 ~/.agents/skills（docs.qoder.cn/qoder/skills），
        // 自身配置在 ~/.qoder；检测只认配置目录。
        skills_dir: ".agents/skills",
        config_dir: ".qoder",
        mcp_config_file: "mcp.json",
        sort_order: 14,
        auto_scan: false,
        scan_agents_dir: true,
        seeded: false,
        project_markers: &[".qoder"],
        capabilities: Capabilities {
            skills: true,
            mcp: None,
            hooks: None,
            plugins: false,
            rules: None,
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "codebuddy",
        label: "CodeBuddy",
        color: "teal",
        // skills 目录按社区惯例 .codebuddy/skills（官方文档未能验证），检测只认 .codebuddy。
        skills_dir: ".codebuddy/skills",
        config_dir: ".codebuddy",
        mcp_config_file: "mcp.json",
        sort_order: 15,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".codebuddy"],
        capabilities: Capabilities {
            skills: true,
            mcp: None,
            hooks: None,
            plugins: false,
            rules: None,
            activity: false,
            builtin: true,
        },
    },
    AgentSpec {
        id: "antigravity",
        label: "Antigravity",
        color: "blue",
        // Antigravity 无 .antigravity 目录：App 个人自定义在 ~/.gemini/config（含 skills/），
        // CLI 另读 ~/.gemini/skills（antigravity.google/docs/customization-discovery）。
        // 接线写 ~/.gemini/skills（CLI 读取），检测只认 ~/.gemini/config。
        skills_dir: ".gemini/skills",
        config_dir: ".gemini/config",
        mcp_config_file: "mcp_config.json",
        sort_order: 16,
        auto_scan: false,
        scan_agents_dir: false,
        seeded: false,
        project_markers: &[".agents", "GEMINI.md"],
        capabilities: Capabilities {
            skills: true,
            mcp: None,
            hooks: None,
            plugins: true,
            rules: Some(&["AGENTS.md", "GEMINI.md"]),
            activity: false,
            builtin: true,
        },
    },
];

pub fn spec_by_id(id: &str) -> Option<&'static AgentSpec> {
    SPECS.iter().find(|spec| spec.id == id)
}

/// 未知 Agent 的项目 rules 回退（保持旧行为）。
pub const FALLBACK_RULE_FILES: &[&str] = &["CLAUDE.md", "AGENTS.md"];

pub fn rule_files_for(agent_id: &str) -> &'static [&'static str] {
    match spec_by_id(agent_id).and_then(|spec| spec.capabilities.rules) {
        Some(files) => files,
        None => FALLBACK_RULE_FILES,
    }
}

/// 本机安装检测：以 Agent 自己的配置目录为安装证据。
/// 注意 skills_dir 不能作为检测依据——多个 Agent 共享 `~/.agents/skills`
/// （Zed/Qoder/Antigravity 等），该目录存在不代表这些 Agent 已安装。
/// 未安装的 Agent 不默认注册，界面保持干净（HarnessKit 式行为）。
pub fn detect_installed_at(home: &std::path::Path, spec: &AgentSpec) -> bool {
    agent_installed_at(home, spec.skills_dir, spec.config_dir)
}

/// 按 Agent 行的路径检测本机安装（对用户自建的 Agent 同样适用）。
/// config_dir 非空时只看 config_dir；为空才回退到 skills_dir。
pub fn agent_installed_at(home: &std::path::Path, skills_dir: &str, config_dir: &str) -> bool {
    if !config_dir.is_empty() {
        return home.join(config_dir).is_dir();
    }
    !skills_dir.is_empty() && home.join(skills_dir).is_dir()
}

/// 将 spec 增量写入 agents 表。
///
/// 与旧逻辑（表空才 seed）不同：按 id upsert，新版本新增的内置 Agent 会
/// 自动补进老用户数据库；已存在的行不会被覆盖（保留用户改动）。
///
/// 注册范围 = `seeded: true` 的核心 Agent + 本机检测到已安装的 Agent；
/// 每次扫描重跑，用户新装某个 Agent 后下一次扫描即自动出现。
pub fn seed_agents(conn: &rusqlite::Connection) {
    let home = dirs::home_dir();
    seed_agents_at(home.as_deref(), conn);
}

pub(crate) fn seed_agents_at(home: Option<&std::path::Path>, conn: &rusqlite::Connection) {
    for spec in SPECS
        .iter()
        .filter(|spec| {
            spec.seeded
                || home
                    .map(|home| detect_installed_at(home, spec))
                    .unwrap_or(false)
        })
    {
        conn.execute(
            "INSERT INTO agents (id, label, skills_dir, config_dir, mcp_config_file, color,
                auto_scan, scan_agents_dir, enabled, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?10)
             ON CONFLICT(id) DO NOTHING",
            params![
                spec.id,
                spec.label,
                spec.skills_dir,
                spec.config_dir,
                spec.mcp_config_file,
                spec.color,
                spec.auto_scan as i64,
                spec.scan_agents_dir as i64,
                spec.sort_order,
                crate::db::now_iso(),
            ],
        )
        .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_installed_requires_either_dir_under_home() {
        let home = std::env::temp_dir().join(format!("skilldeck-agents-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".iflow/skills")).unwrap();

        let spec = spec_by_id("iflow").unwrap();
        assert!(detect_installed_at(&home, spec), "skills dir present → installed");

        let gemini = spec_by_id("gemini").unwrap();
        assert!(!detect_installed_at(&home, gemini), "nothing present → not installed");

        // 只有 config 目录也算安装
        std::fs::create_dir_all(home.join(".gemini")).unwrap();
        assert!(detect_installed_at(&home, gemini), "config dir present → installed");

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn shared_skills_dir_does_not_imply_zed_installed() {
        // 回归：Zed 与其他 Agent 共享 ~/.agents/skills，
        // 共享目录存在不能作为 Zed 已安装的证据（只认 .zed）。
        let home = std::env::temp_dir().join(format!("skilldeck-agents-zed-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".agents/skills")).unwrap();

        let zed = spec_by_id("zed").unwrap();
        assert!(!detect_installed_at(&home, zed), "shared dir must not count as zed installed");

        std::fs::create_dir_all(home.join(".zed")).unwrap();
        assert!(detect_installed_at(&home, zed), ".zed present → installed");

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn seed_registers_core_and_detected_agents_only() {
        let home = std::env::temp_dir().join(format!("skilldeck-agents-seed-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".qwen")).unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE agents (
                id TEXT PRIMARY KEY, label TEXT NOT NULL, skills_dir TEXT NOT NULL,
                config_dir TEXT NOT NULL, mcp_config_file TEXT NOT NULL,
                color TEXT NOT NULL, auto_scan INTEGER NOT NULL DEFAULT 0,
                scan_agents_dir INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );",
        )
        .unwrap();

        seed_agents_at(Some(&home), &conn);

        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM agents ORDER BY sort_order").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
            rows.flatten().collect()
        };
        // 核心 Agent（seeded: true）始终注册
        for core in ["claude", "codex", "trae", "workbuddy", "dsh"] {
            assert!(ids.iter().any(|id| id == core), "core {core} must be seeded");
        }
        // 本机检测到 .qwen → 注册；没装的（cursor/windsurf/zed/iflow…）不注册
        assert!(ids.iter().any(|id| id == "qwen"), "detected qwen must be seeded");
        assert!(!ids.iter().any(|id| id == "cursor"), "undetected cursor must not be seeded");
        assert!(!ids.iter().any(|id| id == "windsurf"), "undetected windsurf must not be seeded");
        assert!(!ids.iter().any(|id| id == "zed"), "zed must not be seeded without .zed dir");

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn capabilities_json_round_trip_fields() {
        let json = spec_by_id("codex").unwrap().capabilities_json();
        assert!(json.contains("\"mcp\":\"codex_toml\""));
        assert!(json.contains("\"hooks\":true"));
        assert!(json.contains("\"plugins\":true"));
        assert!(json.contains("\"rules\":[\"AGENTS.md\"]"));
        assert!(json.contains("\"builtin\":true"));
        let trae = spec_by_id("trae").unwrap().capabilities_json();
        assert!(trae.contains("\"hooks\":false"));
    }

    #[test]
    fn hooks_config_resolves_relative_to_home() {
        let claude = spec_by_id("claude").unwrap().capabilities.hooks.unwrap();
        assert_eq!(claude.file, ".claude/settings.json");
        assert!(!claude.requires_feature_flag);
        let codex = spec_by_id("codex").unwrap().capabilities.hooks.unwrap();
        assert!(codex.requires_feature_flag);
        assert!(spec_by_id("trae").unwrap().capabilities.hooks.is_none());
    }

    #[test]
    fn rule_files_use_registry() {
        assert_eq!(rule_files_for("claude"), &["CLAUDE.md"]);
        assert_eq!(rule_files_for("cursor"), &[".cursorrules"]);
        assert_eq!(rule_files_for("unknown-agent"), FALLBACK_RULE_FILES);
    }

    #[test]
    fn dsh_spec_matches_deepseek_harness_layout() {
        let spec = spec_by_id("dsh").expect("dsh spec must exist");
        assert_eq!(spec.label, "DeepSeek Harness");
        assert_eq!(spec.skills_dir, ".dsh/skills");
        assert_eq!(spec.config_dir, ".dsh");
        // seeded: true → 老库通过 seed_agents 增量补齐
        assert!(spec.seeded);
        // DSH 同时读取 <project>/.dsh/skills 与 <project>/.agents/skills（用户级同理）
        assert!(spec.scan_agents_dir);
        assert_eq!(spec.project_markers, &[".dsh"]);
        // 规则文件：DSH 读取 AGENTS.md/CLAUDE.md 指令文件链，AGENTS.md 是主名
        assert_eq!(rule_files_for("dsh"), &["AGENTS.md"]);
        // MCP 由 cordis.patch.yml 插件条目配置，非简单文件形态，SkillDeck 不代管
        assert!(spec.capabilities.mcp.is_none());
        assert!(spec.capabilities.hooks.is_none());
        assert!(!spec.capabilities.plugins);
        assert!(!spec.capabilities.activity);
        assert!(spec.capabilities.skills);
        assert!(spec.capabilities.builtin);
        // capabilities_json 序列化保持 mcp/hooks 为空
        let json = spec.capabilities_json();
        assert!(json.contains("\"mcp\":null"));
        assert!(json.contains("\"hooks\":false"));
        assert!(json.contains("\"rules\":[\"AGENTS.md\"]"));
    }

    #[test]
    fn seeded_specs_are_unique() {
        let mut ids: Vec<_> = SPECS.iter().filter(|s| s.seeded).map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        let total = SPECS.iter().filter(|s| s.seeded).count();
        assert_eq!(ids.len(), total);
    }
}
