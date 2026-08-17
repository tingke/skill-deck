export interface Skill {
  id: string;
  name: string;
  source_lib: string;
  path: string;
  description: string;
  content_hash: string;
  tags: string[];
  links: string[];
  enabled: boolean;
  author: string;
  license: string;
  version: string;
  permissions: string[];
}

export type ConnectionKind = "symlink" | "real_directory" | "real_file";

export interface SkillConnectionState {
  agent_id: string;
  agent_label: string;
  kind: ConnectionKind;
  entry_path: string;
  target_path: string | null;
  enabled: boolean;
  shared: boolean;
  affected_agents: string[];
}

export interface SharedDisconnectConfirmation {
  skillId: string | null;
  skillIds: string[];
  agentId: string;
  skillName: string;
  affectedAgents: string[];
}

export interface SkillDeleteConfirmation {
  id: string;
  name: string;
  path: string;
}

export interface SkillFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children: SkillFileEntry[];
}

export interface LibrarySource {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  sort_order: number;
}

export interface ActivityLog {
  id: number;
  action: string;
  detail: string;
  created_at: string;
}

export interface AgentInfo {
  id: string;
  label: string;
  color: string;
  default_dir: string;
  auto_scan: boolean;
  scan_agents_dir: boolean;
  config_dir: string;
  mcp_config_file: string;
  enabled: boolean;
  sort_order: number;
}

export const AGENT_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  claude: { bg: "bg-orange-500", dot: "bg-orange-500", text: "text-orange-600" },
  codex: { bg: "bg-green-600", dot: "bg-green-500", text: "text-green-600" },
  trae: { bg: "bg-sky-600", dot: "bg-sky-500", text: "text-sky-600" },
  workbuddy: { bg: "bg-violet-600", dot: "bg-violet-500", text: "text-violet-600" },
};

export type ViewKey = "dashboard" | "skills" | "presets" | "prompts" | "rules" | "mcp" | "plugins" | "hooks" | "agents" | "projects" | "settings" | "design";

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  color: string;
  sort_order: number;
  skill_count: number;
  created_at: string;
  updated_at: string;
}

export interface Prompt {
  id: number;
  title: string;
  content: string;
  tags: string[];
  source: string;
}

export interface Rule {
  id: number;
  title: string;
  content: string;
  platform: string;
  target_path: string | null;
  tags: string[];
  source: string;
}


// ===================== Package (工具集) =====================

export interface PackageRow {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  created_at: string;
  updated_at: string;
  skill_count: number;
  mcp_count: number;
  config_count: number;
}

export interface PackageSkillEntry {
  name: string;
  skill_id: string | null;
  source_path: string;
  position: number;
}

export interface PackageMcpEntry {
  name: string;
  config_json: string;
  position: number;
}

export interface PackageConfigEntry {
  agent: string;
  category: string;
  file_name: string;
  content: string;
  position: number;
}

export interface PackageDetail {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  created_at: string;
  updated_at: string;
  skills: PackageSkillEntry[];
  mcps: PackageMcpEntry[];
  configs: PackageConfigEntry[];
}

export interface PackageSkillInput {
  name: string;
  skill_id: string | null;
  source_path: string;
}

export interface PackageMcpInput {
  name: string;
  config_json: string;
}

export interface PackageConfigInput {
  agent: string;
  category: string;
  file_name: string;
  content: string;
}

export interface PackageInput {
  name: string;
  display_name?: string;
  version?: string;
  description?: string;
  skills: PackageSkillInput[];
  mcps: PackageMcpInput[];
  configs: PackageConfigInput[];
}

// ===================== Extension (MCP / Hook / Plugin) =====================

export interface AgentRow {
  id: string;
  label: string;
  skills_dir: string;
  config_dir: string;
  mcp_config_file: string;
  color: string;
  auto_scan: boolean;
  scan_agents_dir: boolean;
  enabled: boolean;
  sort_order: number;
}

export interface ExtensionRow {
  id: string;
  kind: "mcp" | "hook" | "plugin";
  runtime: string;
  name: string;
  config_json: string;
  enabled: boolean;
  description: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface McpServerInput {
  runtime: string;
  name: string;
  config_json: string;
  old_name?: string;
}

export interface HookInput {
  runtime: string;
  event: string;
  matcher: string;
  command: string;
  timeout: number;
}

export interface PluginToggleInput {
  name: string;
  marketplace: string;
  enabled: boolean;
}

export const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TeammateIdle",
];

// ===================== Settings =====================

export interface AppInfo {
  name: string;
  version: string;
  identifier: string;
  data_dir: string;
  db_path: string;
}

export interface UpdateInfo {
  has_update: boolean;
  current: string;
  latest: string;
  url: string;
  not_configured: boolean;
}
