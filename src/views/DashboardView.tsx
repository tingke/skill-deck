import { useAppStore } from "../stores/app";
import {
  BookOpen, Link2, RefreshCw, Link, Unlink, FileDown,
  Power, ArchiveRestore, Package, Cpu, FolderTree, ScrollText,
  FolderKanban, Server, Webhook, Trash2,
} from "lucide-react";
import { AGENT_COLORS } from "../types";
import type { ActivityLog } from "../types";
import { useT } from "../i18n";
import type { TranslationKey } from "../i18n";
import { AgentGlyph } from "../components/AgentGlyph";

function timeAgo(ts: string, t: (k: TranslationKey, v?: Record<string, string | number>) => string): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - parseInt(ts);
  if (isNaN(diff)) return "";
  if (diff < 60) return t("dashboard.justNow");
  if (diff < 3600) return t("dashboard.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("dashboard.hoursAgo", { n: Math.floor(diff / 3600) });
  return t("dashboard.daysAgo", { n: Math.floor(diff / 86400) });
}

function ActivityIcon({ action }: { action: string }) {
  const icon = () => {
    switch (action) {
      case "connect": return <Link size={12} />;
      case "disconnect": return <Unlink size={12} />;
      case "preset":
      case "package_save":
      case "package_apply":
      case "package_export":
      case "package_import":
      case "package_apply_project": return <Package size={12} />;
      case "batch": return <Link2 size={12} />;
      case "scan": return <RefreshCw size={12} />;
      case "delete":
      case "package_delete":
      case "project_delete":
      case "agent_delete":
      case "library_source_delete":
      case "ext_delete": return <Trash2 size={12} />;
      case "import": return <FileDown size={12} />;
      case "adopt_skill": return <ArchiveRestore size={12} />;
      case "toggle_skill":
      case "ext_toggle":
      case "plugin_toggle": return <Power size={12} />;
      case "agent_save":
      case "agent_toggle": return <Cpu size={12} />;
      case "library_source_save": return <FolderTree size={12} />;
      case "rule_apply":
      case "rule_scan": return <ScrollText size={12} />;
      case "project_save": return <FolderKanban size={12} />;
      case "mcp_save": return <Server size={12} />;
      case "hook_save": return <Webhook size={12} />;
      default: return <Link2 size={12} />;
    }
  };
  const color = () => {
    switch (action) {
      case "connect": case "batch": return "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30";
      case "disconnect":
      case "delete":
      case "package_delete":
      case "project_delete":
      case "agent_delete":
      case "library_source_delete":
      case "ext_delete": return "text-red-400 bg-red-50 dark:bg-red-900/30";
      case "preset":
      case "package_save":
      case "package_apply":
      case "package_export":
      case "package_import":
      case "package_apply_project": return "text-violet-500 bg-violet-50 dark:bg-violet-900/30";
      default: return "text-faint bg-surface-2 ";
    }
  };
  return <span className={"inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0 " + color()}>{icon()}</span>;
}

const ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  connect: "activity.connect",
  disconnect: "activity.disconnect",
  scan: "activity.scan",
  batch: "activity.batch",
  delete: "activity.delete",
  import: "activity.import",
  preset: "activity.preset",
  adopt_skill: "activity.adopt_skill",
  toggle_skill: "activity.toggle_skill",
  rule_apply: "activity.rule_apply",
  rule_scan: "activity.rule_scan",
  project_save: "activity.project_save",
  project_delete: "activity.project_delete",
  ext_scan: "activity.ext_scan",
  ext_toggle: "activity.ext_toggle",
  mcp_save: "activity.mcp_save",
  hook_save: "activity.hook_save",
  hook_observer_toggle: "activity.hook_observer_toggle",
  ext_delete: "activity.ext_delete",
  plugin_toggle: "activity.plugin_toggle",
  package_save: "activity.package_save",
  package_delete: "activity.package_delete",
  package_apply: "activity.package_apply",
  package_export: "activity.package_export",
  package_import: "activity.package_import",
  package_apply_project: "activity.package_apply_project",
  agent_save: "activity.agent_save",
  agent_toggle: "activity.agent_toggle",
  agent_delete: "activity.agent_delete",
  library_source_save: "activity.library_source_save",
  library_source_delete: "activity.library_source_delete",
};

/** Translate legacy backend detail strings; pass language-neutral details through. */
function activityDetail(action: string, detail: string, t: (k: TranslationKey, v?: Record<string, string | number>) => string): string {
  let m: RegExpMatchArray | null;
  if (action === "scan" && (m = detail.match(/^扫描完成，共 (\d+) 个 skill$/))) {
    return t("activity.scanDetail", { count: m[1] });
  }
  if (action === "rule_scan" && (m = detail.match(/^扫描完成，新增 (\d+) 条$/))) {
    return t("activity.ruleScanDetail", { count: m[1] });
  }
  if (action === "toggle_skill" && (m = detail.match(/^(启用|停用) skill: (.+)$/))) {
    return `${m[1] === "启用" ? t("activity.toggleOn") : t("activity.toggleOff")} · ${m[2]}`;
  }
  return detail;
}

export default function DashboardView() {
  const t = useT();
  const { skills, agentOptions, activity, agentActivity: activitySnapshot, setView } = useAppStore();

  const activityStateColor = (state: string) => {
    if (state === "working") return "bg-emerald-500";
    if (state === "waiting") return "bg-amber-500";
    if (state === "failed") return "bg-red-500";
    return "bg-slate-400 dark:bg-slate-500";
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold">{t("dashboard.title")}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Agent status */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-xs font-semibold text-muted mb-3">{t("dashboard.agentStatus")}</h3>
          <div className="space-y-2">
            {agentOptions.map((rt) => {
              const count = skills.filter((s) => s.links.includes(rt.id)).length;
              const color = AGENT_COLORS[rt.id] || AGENT_COLORS.claude;
              const displayDir = "~/" + rt.default_dir.split("/").slice(-2).join("/");
              return (
                <div key={rt.id} className="flex items-center gap-2.5">
                  <AgentGlyph id={rt.id} label={rt.label} size={22} />
                  <span className="text-xs dark:text-faint">{rt.label}</span>
                  <span className="text-[10px] text-muted font-mono ml-auto truncate">{displayDir}</span>
                  <span className={"text-[10px] font-medium " + color.text}>{t("dashboard.connected", { count })}</span>
                </div>
              );
            })}
          </div>
          <button onClick={() => setView("skills")} className="flex items-center gap-1 text-[11px] text-faint hover:text-content dark:hover:text-content mt-3">
            <BookOpen size={12} /> {t("dashboard.goSkills")} <Link2 size={12} />
          </button>
        </div>

        {/* Recent activity */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-xs font-semibold text-muted mb-3">{t("dashboard.recentActivity")}</h3>
          {activity.length === 0 ? (
            <p className="text-xs text-faint py-4 text-center">{t("dashboard.noActivity")}</p>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 6).map((a: ActivityLog) => (
                <div key={a.id} className="flex items-center gap-2.5 py-0.5">
                  <ActivityIcon action={a.action} />
                  <span className="text-xs text-muted truncate flex-1">
                    <span className="font-medium">{t(ACTION_LABEL_KEYS[a.action] ?? "activity.unknown")}</span>
                    <span className="text-faint"> · {activityDetail(a.action, a.detail, t)}</span>
                  </span>
                  <span className="text-[10px] text-faint shrink-0">{timeAgo(a.created_at, t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Agent activity observed by hooks */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold text-muted">{t("dashboard.agentActivity")}</h3>
            <button onClick={() => setView("hooks")} className="text-[11px] text-faint hover:text-content dark:hover:text-content">
              {t("dashboard.configureHooks")}
            </button>
          </div>
          {activitySnapshot.events.length === 0 ? (
            <p className="text-xs text-faint py-4 text-center">{t("dashboard.noAgentActivity")}</p>
          ) : (
            <div className="space-y-2">
              {activitySnapshot.events.slice(0, 6).map((event) => (
                <div key={event.id} className="flex items-center gap-2.5 min-w-0">
                  <span className={"w-2 h-2 rounded-full shrink-0 " + activityStateColor(event.state)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-content truncate">{event.agent}</span>
                      <span className="text-2xs text-faint truncate">
                        {event.toolName || event.event}
                      </span>
                    </div>
                    <p className="text-2xs text-faint truncate">{event.activity || event.project}</p>
                  </div>
                  <span className="text-2xs text-faint shrink-0">{timeAgo(String(event.timestamp), t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Generic task progress reported by hooks */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-xs font-semibold text-muted mb-3">{t("dashboard.taskProgress")}</h3>
          {activitySnapshot.tasks.length === 0 ? (
            <p className="text-xs text-faint py-4 text-center">{t("dashboard.noTaskProgress")}</p>
          ) : (
            <div className="space-y-2.5">
              {activitySnapshot.tasks.slice(0, 5).map((task) => (
                <div key={`${task.projectPath}:${task.taskId}`} className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-content truncate flex-1">{task.title}</span>
                    <span className="text-2xs text-faint shrink-0">
                      {task.progress === null ? "--" : `${Math.round(task.progress * 100)}%`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={
                        "h-full rounded-full " +
                        (task.progress === null
                          ? "bg-sky-500/50"
                          : task.progress >= 1
                            ? "bg-emerald-500"
                            : "bg-sky-500")
                      }
                      style={{
                        width: task.progress === null ? "100%" : `${Math.round(task.progress * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-2xs text-faint truncate mt-1">
                    {task.projectName} · {task.status}
                    {task.step ? ` · ${task.step}` : ""}
                    {task.activeAgent ? ` · ${task.activeAgent}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
