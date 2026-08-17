import { useAppStore } from "../stores/app";
import { BookOpen, Link2, RefreshCw, Link, Unlink, Repeat, Plus, FileDown } from "lucide-react";
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
      case "preset": return <Repeat size={12} />;
      case "batch": return <Link2 size={12} />;
      case "scan": return <RefreshCw size={12} />;
      case "delete": return <Plus size={12} className="rotate-45" />;
      case "import": return <FileDown size={12} />;
      default: return <Link2 size={12} />;
    }
  };
  const color = () => {
    switch (action) {
      case "connect": case "batch": return "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30";
      case "disconnect": return "text-red-400 bg-red-50 dark:bg-red-900/30";
      case "preset": return "text-violet-500 bg-violet-50 dark:bg-violet-900/30";
      default: return "text-faint bg-surface-2 ";
    }
  };
  return <span className={"inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0 " + color()}>{icon()}</span>;
}

export default function DashboardView() {
  const t = useT();
  const { skills, agentOptions, activity, setView } = useAppStore();
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
                  <span className="text-xs text-muted truncate flex-1">{a.detail}</span>
                  <span className="text-[10px] text-faint shrink-0">{timeAgo(a.created_at, t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
