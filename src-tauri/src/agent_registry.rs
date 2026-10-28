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

/// 将 `seeded: true` 的 spec 增量写入 agents 表。
///
/// 与旧逻辑（表空才 seed）不同：按 id upsert，新版本新增的内置 Agent 会
/// 自动补进老用户数据库；已存在的行不会被覆盖（保留用户改动）。
pub fn seed_agents(conn: &rusqlite::Connection) {
    for spec in SPECS.iter().filter(|spec| spec.seeded) {
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
    fn seeded_specs_are_unique() {
        let mut ids: Vec<_> = SPECS.iter().filter(|s| s.seeded).map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        let total = SPECS.iter().filter(|s| s.seeded).count();
        assert_eq!(ids.len(), total);
    }
}
