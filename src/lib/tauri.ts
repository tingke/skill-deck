import { invoke } from "@tauri-apps/api/core";
import type {
  Skill, ActivityLog, Prompt, Rule, AgentInfo, ProjectRow, SkillConnectionState,
  AuditReport, InstallResult, SkillSourceInput, UpdateAvailability,
} from "../types";
import type { AgentRow } from "../types";

// Agent 配置；保留 get_runtimes 命令作为 Tauri 兼容入口
export const getAgentOptions = () =>
  invoke<AgentInfo[]>("get_runtimes");

export const verifyConnections = () =>
  invoke<Skill[]>("verify_connections");

 // 扫描
 export const scanAll = (log = false) =>
   invoke<Skill[]>("scan_all", { log });

 export const getSkills = () =>
   invoke<Skill[]>("get_skills");

 // 接线
 export const connectSkill = (skillId: string, agentId: string) =>
   invoke("connect_skill", { skillId, agentId });

 export const disconnectSkill = (skillId: string, agentId: string, confirmedShared = false) =>
   invoke("disconnect_skill", { skillId, agentId, confirmedShared });

export const batchConnect = (
  connectIds: string[],
  disconnectIds: string[],
  agentId: string,
  confirmedShared = false,
) => invoke("batch_connect", { connectIds, disconnectIds, agentId, confirmedShared });

export const getSkillConnections = (skillId: string) =>
  invoke<SkillConnectionState[]>("get_skill_connections", { skillId });

export const adoptRealEntry = (
  skillId: string,
  agentId: string,
  librarySourceId: string,
) => invoke<SkillConnectionState>("adopt_real_entry", { skillId, agentId, librarySourceId });

// skill 文件读写
export const readSkillFile = (skillId: string) =>
  invoke<string>("read_skill_file", { skillId });

export const writeSkillFile = (skillId: string, content: string) =>
  invoke("write_skill_file", { skillId, content });

export const deleteSkill = (skillId: string) =>
  invoke("delete_skill", { skillId });

export const updateSkillTags = (skillId: string, tags: string[]) =>
  invoke("update_skill_tags", { skillId, tags });

export const toggleSkillEnabled = (skillId: string, enabled: boolean) =>
  invoke("toggle_skill_enabled", { skillId, enabled });

export const listSkillFiles = (skillId: string) =>
  invoke<import("../types").SkillFileEntry[]>("list_skill_files", { skillId });

export const readSkillFileByPath = (skillId: string, filePath: string) =>
  invoke<string>("read_skill_file_path", { skillId, filePath });

// skill 安全审查
export const auditSkill = (skillId: string) =>
  invoke<AuditReport>("audit_skill", { skillId });

export const getSkillAudit = (skillId: string) =>
  invoke<AuditReport>("get_skill_audit", { skillId });

// skill 安装 / 更新
export const installSkill = (
  source: SkillSourceInput,
  librarySourceId: string,
  overrideAudit = false,
) => invoke<InstallResult>("install_skill", { source, librarySourceId, overrideAudit });

export const updateSkill = (
  skillId: string,
  overrideAudit = false,
  allowLocalChanges = false,
) => invoke<InstallResult>("update_skill", { skillId, overrideAudit, allowLocalChanges });

export const checkSkillUpdates = (skillIds: string[]) =>
  invoke<UpdateAvailability[]>("check_skill_updates", { skillIds });

// 库源 (Library Sources)
import type { LibrarySource } from "../types";

export const getLibrarySources = () =>
  invoke<LibrarySource[]>("get_library_sources");

export const saveLibrarySource = (source: LibrarySource) =>
  invoke("save_library_source", { source });

export const deleteLibrarySource = (id: string) =>
  invoke("delete_library_source", { id });

// 活动日志
export const getRecentActivity = () =>
  invoke<ActivityLog[]>("get_recent_activity");

export const getPrompts = () =>
  invoke<Prompt[]>("get_prompts");

export const savePrompt = (
  id: number | null,
  title: string,
  content: string,
  tags: string[],
) => invoke<Prompt>("save_prompt", { id, title, content, tags });

export const deletePrompt = (id: number) =>
  invoke("delete_prompt", { id });

// Rules
export const getRules = () =>
  invoke<Rule[]>("get_rules");

export const saveRule = (
  id: number | null,
  title: string,
  content: string,
  platform: string,
  targetPath: string | null,
  tags: string[],
) => invoke<Rule>("save_rule", { id, title, content, platform, targetPath, tags });

export const deleteRule = (id: number) =>
  invoke("delete_rule", { id });
export const applyRule = (id: number) =>
  invoke<string>("apply_rule", { id });

export const scanRules = () =>
  invoke<Rule[]>("scan_rules");

// ===================== Packages (工具集) =====================
import type {
  PackageRow,
  PackageDetail,
  PackageInput,
  PackageApplyPlan,
  PackageExportResult,
} from "../types";

export const getPackages = () =>
  invoke<PackageRow[]>("get_packages");

export const getPackage = (id: string) =>
  invoke<PackageDetail>("get_package", { id });

export const savePkg = (input: PackageInput, id: string | null) =>
  invoke<string>("save_pkg", { input, id });

export const deletePkg = (id: string) =>
  invoke("delete_pkg", { id });

export const applyPkg = (id: string, agentId: string) =>
  invoke("apply_pkg", { id, runtime: agentId });

export const previewPkg = (id: string, agentId: string) =>
  invoke<PackageApplyPlan>("preview_pkg", { id, runtime: agentId });

export const previewPkgToProject = (id: string, projectPath: string) =>
  invoke<PackageApplyPlan>("preview_pkg_to_project", { id, projectPath });

export const exportPkg = (id: string, destDir?: string, includeSecrets = false) =>
  invoke<PackageExportResult>("export_pkg", {
    id,
    destDir: destDir ?? null,
    includeSecrets,
  });

export const importPkg = (
  zipPath: string,
  librarySourceId?: string,
  overrideAudit = false,
) =>
  invoke<string>("import_pkg", {
    zipPath,
    librarySourceId: librarySourceId ?? null,
    overrideAudit,
  });

export const pickFolder = () =>
  invoke<string | null>("pick_folder");

export const pickSaveFolder = () =>
  invoke<string | null>("pick_save_folder");

export const applyPkgToProject = (
  id: string,
  projectPath: string,
  confirmedOverwrite = false,
) =>
  invoke("apply_pkg_to_project", { id, projectPath, confirmedOverwrite });

export const createPkgFromProject = (projectId: string) =>
  invoke<PackageRow>("create_pkg_from_project", { projectId });

export const getProjectDrifts = () =>
  invoke<import("../types").ProjectPackageDrift[]>("get_project_drifts");


// ===================== Extensions (MCP / Hook / Plugin) =====================
import type { ExtensionRow, McpServerInput, HookInput, PluginToggleInput } from "../types";

export const scanExt = () =>
  invoke<ExtensionRow[]>("scan_ext");

export const getExt = () =>
  invoke<ExtensionRow[]>("get_ext");

export const toggleExt = (id: string, enabled: boolean) =>
  invoke("toggle_ext", { id, enabled });

export const saveMcpCmd = (input: McpServerInput) =>
  invoke("save_mcp_cmd", { input });

export const saveHookCmd = (input: HookInput) =>
  invoke("save_hook_cmd", { input });

export const togglePlugin = (input: PluginToggleInput) =>
  invoke("toggle_plugin_cmd", { input });

export const deleteExt = (id: string) =>
  invoke("delete_ext", { id });

export const getHookObserverStatus = () =>
  invoke<import("../types").HookObserverStatus[]>("get_hook_observer_status");

export const setHookObserverEnabled = (agent: string, enabled: boolean) =>
  invoke<import("../types").HookObserverStatus>("set_hook_observer_enabled", { agent, enabled });

export const getAgentActivitySnapshot = () =>
  invoke<import("../types").AgentActivitySnapshot>("get_agent_activity_snapshot");


// ===================== Finder / 路径 =====================

// ===================== Agents (运行环境注册表) =====================

export const getAgents = () =>
  invoke<AgentRow[]>("get_agents");

export const saveAgent = (agent: AgentRow) =>
  invoke("save_agent", { agent });

export const toggleAgent = (id: string, enabled: boolean) =>
  invoke("toggle_agent", { id, enabled });

export const deleteAgent = (id: string) =>
  invoke("delete_agent", { id });

export const agentMcpPath = (id: string) =>
  invoke<string>("agent_mcp_path", { id });

// ===================== Projects (项目管理) =====================

export const getProjects = () =>
  invoke<ProjectRow[]>("get_projects");

export const saveProject = (project: ProjectRow) =>
  invoke("save_project", { project });

export const deleteProject = (id: string) =>
  invoke("delete_project", { id });

export const pickProjectFolder = () =>
  invoke<string | null>("pick_project_folder");

export const revealInFinder = (path: string) =>
  invoke("reveal_in_finder", { path });

export const getHomeDirectory = () =>
  invoke<string>("get_home_directory");

export const extConfigPath = (id: string) =>
  invoke<string>("ext_config_path", { id });

// ===================== Settings =====================
import type { AppInfo } from "../types";

export const getAppInfo = () =>
  invoke<AppInfo>("get_app_info");

export const isAutostartEnabled = () =>
  invoke<boolean>("is_autostart_enabled");

export const setAutostart = (enabled: boolean) =>
  invoke<boolean>("set_autostart", { enabled });

export const backupDatabase = (destDir: string) =>
  invoke<string>("backup_database", { destDir });

export const restoreDatabase = (srcPath: string) =>
  invoke("restore_database", { srcPath });

export const pickBackupFolder = () =>
  invoke<string | null>("pick_backup_folder");

export const pickBackupFile = () =>
  invoke<string | null>("pick_backup_file");

// ===================== App 更新 (updater 插件) =====================
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const checkAppUpdate = () => check();
export type { Update };
export const relaunchApp = () => relaunch();
