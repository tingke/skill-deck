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
  audit_verdict?: string | null;
  audit_score?: number | null;
  origin_type?: string | null;
  origin_ref?: string | null;
}

export type AuditSeverity = "info" | "warn" | "block";
export type AuditVerdict = "pass" | "warn" | "block";

export interface AuditFinding {
  rule_id: string;
  severity: AuditSeverity;
  location: string;
  message: string;
}

export interface AuditReport {
  content_hash: string;
  verdict: AuditVerdict;
  findings: AuditFinding[];
  score: number;
  created_at: string;
}

export interface AuditRuleInfo {
  rule_id: string;
  severity: AuditSeverity;
  title: string;
  description: string;
}

export interface AuditScoreModel {
  base: number;
  block_penalty: number;
  warn_penalty: number;
  info_penalty: number;
}

export interface AuditRulesResponse {
  rules: AuditRuleInfo[];
  score_model: AuditScoreModel;
  engine_version: number;
}

export interface SkillAuditSummary {
  skill_id: string;
  name: string;
  source_lib: string;
  verdict: AuditVerdict;
  score: number;
  block_count: number;
  warn_count: number;
  info_count: number;
  finding_count: number;
  created_at: string;
}

export type SkillSourceKind = "git" | "archive" | "path";

export interface SkillSourceInput {
  kind: SkillSourceKind;
  source_ref: string;
  subdir?: string | null;
}

export type InstallStatus =
  | "installed"
  | "conflict"
  | "audit_blocked"
  | "audit_warned"
  | "up_to_date"
  | "local_changes"
  | "updated";

export interface InstallResult {
  status: InstallStatus;
  skill_id: string | null;
  skill_name: string;
  target_path: string;
  message: string;
  report: AuditReport | null;
}

export interface UpdateAvailability {
  skill_id: string;
  skill_name: string;
  has_update: boolean;
  local_changes: boolean;
  error: string | null;
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

export interface AgentCapabilities {
  skills: boolean;
  /** MCP 格式：claude_json / codex_toml / json_servers / null = 不支持 */
  mcp: string | null;
  hooks: boolean;
  plugins: boolean;
  /** 项目 rules 目标文件；null 表示回退 CLAUDE.md/AGENTS.md */
  rules: string[] | null;
  activity: boolean;
  /** 内置 agent，不可删除 */
  builtin: boolean;
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
  capabilities: AgentCapabilities;
}

export const AGENT_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  claude: { bg: "bg-orange-500", dot: "bg-orange-500", text: "text-orange-600" },
  codex: { bg: "bg-green-600", dot: "bg-green-500", text: "text-green-600" },
  trae: { bg: "bg-sky-600", dot: "bg-sky-500", text: "text-sky-600" },
  workbuddy: { bg: "bg-violet-600", dot: "bg-violet-500", text: "text-violet-600" },
  cursor: { bg: "bg-slate-500", dot: "bg-slate-400", text: "text-slate-600" },
  gemini: { bg: "bg-sky-500", dot: "bg-sky-400", text: "text-sky-500" },
  windsurf: { bg: "bg-teal-500", dot: "bg-teal-400", text: "text-teal-600" },
  opencode: { bg: "bg-amber-500", dot: "bg-amber-400", text: "text-amber-600" },
};

/** 未匹配时的回退颜色，新 agent 不必每次补这里。 */
export const AGENT_COLOR_FALLBACK = { bg: "bg-slate-400", dot: "bg-slate-400", text: "text-slate-500" };

export function agentColor(id: string) {
  return AGENT_COLORS[id] ?? AGENT_COLOR_FALLBACK;
}

export type ViewKey = "dashboard" | "market" | "skills" | "audit" | "presets" | "prompts" | "rules" | "mcp" | "plugins" | "hooks" | "agents" | "projects" | "settings" | "design";

export interface MarketplaceInput {
  name: string;
  description: string;
  placeholder: string;
  is_secret: boolean;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  homepage: string | null;
  source: SkillSourceInput;
}

export interface MarketplaceMcp {
  id: string;
  name: string;
  server_name: string;
  description: string;
  author: string;
  tags: string[];
  version: string | null;
  homepage: string | null;
  config: Record<string, unknown> | null;
  required_inputs: MarketplaceInput[];
}

export interface MarketplaceCatalog {
  source_kind: string;
  source_url: string;
  name: string;
  synced_at: string;
  skills: MarketplaceSkill[];
  mcps: MarketplaceMcp[];
}

export interface MarketplaceSyncInput {
  url: string;
  max_items?: number | null;
}

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

export interface ProjectPackageDrift {
  project_id: string;
  project_name: string;
  project_path: string;
  project_exists: boolean;
  package_id: string | null;
  package_name: string;
  status: "missing" | "up_to_date" | "drifted" | "invalid" | string;
  skills_missing: number;
  skills_extra: number;
  mcps_added: number;
  mcps_removed: number;
  mcps_changed: number;
  configs_added: number;
  configs_removed: number;
  configs_changed: number;
  has_changes: boolean;
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

export interface PackageApplyAction {
  kind: string;
  name: string;
  action: string;
  target: string;
  detail: string;
  blocked: boolean;
}

export interface PackageApplyPlan {
  package_id: string;
  package_name: string;
  scope: string;
  agent_id: string;
  project_path?: string | null;
  actions: PackageApplyAction[];
  blocked_count: number;
}

export interface PackageExportResult {
  zip_path: string;
  redacted_keys: string[];
  included_secrets: boolean;
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
  capabilities: AgentCapabilities;
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
  "SessionStart",
  "ProgressUpdate",
  "TaskProgress",
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

export interface HookObserverStatus {
  agent: string;
  installed: boolean;
  configExists: boolean;
  configPath: string;
}

export interface AgentActivityEvent {
  id: string;
  agent: string;
  sessionId: string;
  event: string;
  state: "working" | "waiting" | "failed" | "done" | string;
  project: string;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  taskProgress: number | null;
  step: string | null;
  toolName: string | null;
  activity: string | null;
  timestamp: number;
}

export interface TaskProgress {
  projectPath: string;
  projectName: string;
  taskId: string;
  title: string;
  status: string;
  progress: number | null;
  step: string | null;
  updatedAt: number;
  activeAgent: string | null;
  lastEvent: string | null;
  lastTool: string | null;
  lastActivity: string | null;
  lastActivityAt: number | null;
}

export interface AgentActivitySnapshot {
  events: AgentActivityEvent[];
  tasks: TaskProgress[];
}

// ===================== Settings =====================

export interface AppInfo {
  name: string;
  version: string;
  identifier: string;
  data_dir: string;
  db_path: string;
}
