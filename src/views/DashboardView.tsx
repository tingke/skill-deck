import { useUiStore } from "../stores/ui";
import { useSkillsStore } from "../stores/skills";
import { useActivityStore } from "../stores/activity";
import { useWorkspaceStore } from "../stores/workspace";
import { useExtensionsStore } from "../stores/extensions";
import {
  BookOpen, Link2, RefreshCw, Link, Unlink, FileDown,
  Power, ArchiveRestore, Package, Cpu, FolderTree, ScrollText,
  FolderKanban, Server, Webhook, Trash2, Clock, Radio, ListTodo,
  CheckCircle2,
} from "lucide-react";
import { AGENT_COLORS } from "../types";
import type { ActivityLog } from "../types";
import { useT } from "../i18n";
import PageHeader from "../components/PageHeader";
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
      case "package_apply_project": return "text-accent bg-accent-soft";
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

/**
 * i18n keys introduced by the dashboard redesign. zh/en values are listed in the
 * delivery report and must be added to src/i18n/zh.ts and src/i18n/en.ts by the
 * parent agent (i18n files are out of this task's scope). Until a key lands,
 * t() falls back to the raw key string; the double cast only keeps TS strict
 * green because TranslationKey is `keyof typeof zh` and cannot be extended here.
 */
type NewDashboardKey =
  | "dashboard.metricSkills"
  | "dashboard.metricLinks"
  | "dashboard.metricAgents"
  | "dashboard.metricTools"
  | "dashboard.todoTitle"
  | "dashboard.todoUnlinked"
  | "dashboard.todoUnlinkedSub"
  | "dashboard.todoNoSkills"
  | "dashboard.todoNoSkillsSub"
  | "dashboard.todoGoMarket"
  | "dashboard.todoAllSet"
  | "dashboard.todoAllSetSub"
  | "dashboard.matrixTitle"
  | "dashboard.matrixColSkills"
  | "dashboard.matrixColPlugins"
  | "dashboard.matrixColHooks"
  | "dashboard.matrixEmpty";
const asKey = (key: NewDashboardKey): TranslationKey => key as string as TranslationKey;

type TodoAction = {
  key: string;
  main: string;
  sub: string;
  button?: { label: string; onClick: () => void };
};

export default function DashboardView() {
  const t = useT();
  const { skills, agentOptions } = useSkillsStore();
  const globalScan = useSkillsStore((s) => s.globalScan);
  const globalScanning = useSkillsStore((s) => s.globalScanning);
  const { activity, agentActivity: activitySnapshot } = useActivityStore();
  const agents = useWorkspaceStore((s) => s.agents);
  const extensions = useExtensionsStore((s) => s.extensions);
  const setView = useUiStore((s) => s.setView);

  const activityStateColor = (state: string) => {
    if (state === "working") return "bg-emerald-500";
    if (state === "waiting") return "bg-amber-500";
    if (state === "failed") return "bg-red-500";
    return "bg-slate-400 dark:bg-slate-500";
  };

  const linkCount = skills.reduce((n, s) => n + s.links.length, 0);

  const metrics = [
    { label: t(asKey("dashboard.metricSkills")), value: skills.length },
    { label: t(asKey("dashboard.metricLinks")), value: linkCount },
    { label: t(asKey("dashboard.metricAgents")), value: agents.length },
    { label: t(asKey("dashboard.metricTools")), value: extensions.length },
  ];

  // Priority: a) one row per enabled agent without any linked skill, then
  // b) no skills at all; rows are capped at 3; c) otherwise a single all-set row.
  const todoActions: TodoAction[] = agents
    .filter((a) => a.enabled && !skills.some((s) => s.links.includes(a.id)))
    .map((a) => ({
      key: `unlinked-${a.id}`,
      main: t(asKey("dashboard.todoUnlinked"), { label: a.label }),
      sub: t(asKey("dashboard.todoUnlinkedSub")),
      button: { label: t("dashboard.goSkills"), onClick: () => setView("skills") },
    }));
  if (skills.length === 0) {
    todoActions.push({
      key: "no-skills",
      main: t(asKey("dashboard.todoNoSkills")),
      sub: t(asKey("dashboard.todoNoSkillsSub")),
      button: { label: t("dashboard.goSkills"), onClick: () => setView("skills") },
    });
  }
  if (todoActions.length === 0) {
    todoActions.push({
      key: "all-set",
      main: t(asKey("dashboard.todoAllSet")),
      sub: t(asKey("dashboard.todoAllSetSub")),
    });
  }
  const actions = todoActions.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.realtime")}
        actions={
          <button
            data-testid="global-scan-toggle"
            onClick={globalScan}
            disabled={globalScanning}
            className="btn btn-outline btn-sm"
            title={t("common.globalScan")}
            aria-label={t("common.globalScan")}
          >
            <RefreshCw size={12} className={globalScanning ? "animate-spin" : ""} />
            <span className="hidden lg:inline">重新扫描</span>
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">

      <div className="space-y-3">
        {/* Metrics row */}
        <div className="grid grid-cols-4 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="card px-3.5 py-3">
              <div className="text-[21px] font-bold tnum leading-tight">{m.value}</div>
              <div className="text-[10.5px] text-faint mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>

        {/* What to do now + capability matrix */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">{t(asKey("dashboard.todoTitle"))}</h3>
            <div className="space-y-3">
              {actions.map((a) => (
                <div key={a.key} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-heading truncate">{a.main}</p>
                    <p className="text-xs text-faint truncate">{a.sub}</p>
                  </div>
                  {a.button ? (
                    <button onClick={a.button.onClick} className="btn btn-outline btn-sm shrink-0">{a.button.label}</button>
                  ) : (
                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">{t(asKey("dashboard.matrixTitle"))}</h3>
            {agents.length === 0 ? (
              <p className="text-xs text-faint">{t(asKey("dashboard.matrixEmpty"))}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-faint">
                    <th className="py-1 pr-2 text-left font-normal"></th>
                    <th className="py-1 px-2 text-right font-normal">{t(asKey("dashboard.matrixColSkills"))}</th>
                    <th className="py-1 px-2 text-right font-normal">MCP</th>
                    <th className="py-1 px-2 text-right font-normal">{t(asKey("dashboard.matrixColPlugins"))}</th>
                    <th className="py-1 px-2 text-right font-normal">{t(asKey("dashboard.matrixColHooks"))}</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => {
                    const cells = [
                      skills.filter((s) => s.links.includes(a.id)).length,
                      extensions.filter((e) => e.runtime === a.id && e.kind === "mcp").length,
                      extensions.filter((e) => e.runtime === a.id && e.kind === "plugin").length,
                      extensions.filter((e) => e.runtime === a.id && e.kind === "hook").length,
                    ];
                    return (
                      <tr key={a.id} className="border-t border-border-subtle">
                        <td className="py-1.5 pr-2 min-w-0">
                          <span className="flex items-center gap-2 min-w-0">
                            <AgentGlyph id={a.id} label={a.label} size={18} active={a.enabled} />
                            <span className="truncate">{a.label}</span>
                          </span>
                        </td>
                        {cells.map((v, i) => (
                          <td key={i} className={"py-1.5 px-2 text-right tnum " + (v === 0 ? "text-faint" : "text-content")}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Agent status + recent activity */}
        <div className="grid grid-cols-2 gap-3">
        {/* Agent status */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">{t("dashboard.agentStatus")}</h3>
          <div className="space-y-2">
            {agentOptions.map((rt) => {
              const count = skills.filter((s) => s.links.includes(rt.id)).length;
              const color = AGENT_COLORS[rt.id] || AGENT_COLORS.claude;
              const displayDir = "~/" + rt.default_dir.split("/").slice(-2).join("/");
              return (
                <div key={rt.id} className="flex items-center gap-2.5">
                  <AgentGlyph id={rt.id} label={rt.label} size={22} />
                  <span className="text-xs dark:text-faint">{rt.label}</span>
                  <span className="text-[12px] text-muted font-mono ml-auto truncate">{displayDir}</span>
                  <span className={"text-[12px] font-medium " + color.text}>{t("dashboard.connected", { count })}</span>
                </div>
              );
            })}
          </div>
          <button onClick={() => setView("skills")} className="flex items-center gap-1 text-[13px] text-faint hover:text-accent mt-3 transition-colors">
            <BookOpen size={12} /> {t("dashboard.goSkills")} <Link2 size={12} />
          </button>
        </div>

        {/* Recent activity */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">{t("dashboard.recentActivity")}</h3>
          {activity.length === 0 ? (
            <div className="mini-empty">
              <div className="mini-empty__icon"><Clock size={15} strokeWidth={1.5} /></div>
              <p className="mini-empty__text">{t("dashboard.noActivity")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 6).map((a: ActivityLog) => (
                <div key={a.id} className="flex items-center gap-2.5 py-0.5">
                  <ActivityIcon action={a.action} />
                  <span className="text-xs text-muted truncate flex-1">
                    <span className="font-medium">{t(ACTION_LABEL_KEYS[a.action] ?? "activity.unknown")}</span>
                    <span className="text-faint"> · {activityDetail(a.action, a.detail, t)}</span>
                  </span>
                  <span className="text-[12px] text-faint shrink-0">{timeAgo(a.created_at, t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        </div>

        {/* Agent activity + task progress */}
        <div className="grid grid-cols-2 gap-3">
        {/* Live Agent activity observed by hooks */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{t("dashboard.agentActivity")}</h3>
            <button onClick={() => setView("hooks")} className="text-[13px] text-faint hover:text-accent transition-colors">
              {t("dashboard.configureHooks")}
            </button>
          </div>
          {activitySnapshot.events.length === 0 ? (
            <div className="mini-empty">
              <div className="mini-empty__icon"><Radio size={15} strokeWidth={1.5} /></div>
              <p className="mini-empty__text">{t("dashboard.noAgentActivity")}</p>
            </div>
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
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">{t("dashboard.taskProgress")}</h3>
          {activitySnapshot.tasks.length === 0 ? (
            <div className="mini-empty">
              <div className="mini-empty__icon"><ListTodo size={15} strokeWidth={1.5} /></div>
              <p className="mini-empty__text">{t("dashboard.noTaskProgress")}</p>
            </div>
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
                        "h-full rounded-full transition-all duration-normal " +
                        (task.progress === null
                          ? "bg-tertiary-soft"
                          : task.progress >= 1
                            ? "bg-emerald-500"
                            : "")
                      }
                      style={
                        task.progress !== null && task.progress < 1
                          ? {
                              width: `${Math.round(task.progress * 100)}%`,
                              background: "var(--grad-brand-h)",
                            }
                          : {
                              width: "100%",
                            }
                      }
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
    </div>
    </div>
  );
}
