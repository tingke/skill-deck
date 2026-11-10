import { useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";
import { useSkillsStore } from "../stores/skills";
import { useAssetsStore } from "../stores/assets";
import { useExtensionsStore } from "../stores/extensions";
import { useWorkspaceStore } from "../stores/workspace";
import { usePackagesStore } from "../stores/packages";
import { useActivityStore } from "../stores/activity";
import { useToastStore } from "../stores/toast";
import { useT, useI18n, LANGS, type Lang } from "../i18n";
import type { TranslationKey } from "../i18n";
import * as api from "../lib/tauri";
import type { AppInfo } from "../types";
import PageHeader from "../components/PageHeader";
import {
  Sun, Moon, Monitor, Palette, Database, Info,
  Power, Download, Upload, Globe, Loader2,
} from "lucide-react";

const toast = () => useToastStore.getState();



export default function SettingsView() {
  const t = useT();
  const { theme, setTheme } = useUiStore();

  // Launch at login
  const [autostart, setAutostart] = useState(false);
  useEffect(() => { api.isAutostartEnabled().then(setAutostart).catch(() => {}); }, []);
  const toggleAutostart = async (v: boolean) => {
    try {
      await api.setAutostart(v);
      setAutostart(v);
     toast().show(v ? t("toast.autostartOn") : t("toast.autostartOff"));
    } catch { toast().show(t("toast.failed"), "error"); }
  };

  // Language
  const { lang, setLang } = useI18n();

  // GitHub 访问令牌（用于安装/更新 skill 时的 git clone）
  const [githubToken, setGithubToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  useEffect(() => { api.getSetting("github_token").then((v) => setGithubToken(v ?? "")).catch(() => {}); }, []);
  const saveGithubToken = async () => {
    setTokenSaving(true);
    try {
      await api.setSetting("github_token", githubToken.trim());
      toast().show(t("settings.tokenSaved"));
    } catch {
      toast().show(t("toast.failed"), "error");
    } finally {
      setTokenSaving(false);
    }
  };

  // App info + update
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<api.Update | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<"idle" | "downloading" | "restarting">("idle");
  const [progress, setProgress] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => { api.getAppInfo().then(setAppInfo).catch(() => {}); }, []);
  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const found = await api.checkAppUpdate();
      setUpdate(found);
      setUpdatePhase("idle");
      setProgress(0);
      if (found) {
        setUpdateDialogOpen(true);
      } else {
        toast().show(t("settings.upToDate"));
      }
    } catch (error) {
      // 发布源暂无 latest.json（首个带更新清单的版本发布前）时，updater 插件把
      // 404 统一报成 "Could not fetch a valid release JSON from the remote"——
      // 语义上就是"远程没有可用更新"，按已最新处理，不当作故障
      const message = String(error);
      if (/could not fetch a valid release|releaseNotFound|404|not found/i.test(message)) {
        setUpdate(null);
        setUpdatePhase("idle");
        toast().show(t("settings.upToDate"));
      } else {
        toast().show(t("settings.checkFailed"), "error");
      }
    } finally { setChecking(false); }
  };

  const handleDownloadUpdate = async () => {
    if (!update || updatePhase === "downloading" || updatePhase === "restarting") return;
    setUpdatePhase("downloading");
    setProgress(0);
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((received / total) * 100)));
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      // 安装完成后自动重启应用，无需用户再点「重启」
      setUpdatePhase("restarting");
      setTimeout(() => { api.relaunchApp().catch(() => {}); }, 800);
    } catch {
      setUpdatePhase("idle");
      toast().show(t("settings.updateFailed"), "error");
    }
  };

  // Backup / restore
  const handleBackup = async () => {
    const dir = await api.pickBackupFolder();
    if (!dir) return;
    try {
      const path = await api.backupDatabase(dir);
      toast().show(t("toast.backupDone", { path }));
    } catch { toast().show(t("toast.backupFailed"), "error"); }
  };

  const handleRestore = async () => {
    const file = await api.pickBackupFile();
    if (!file) return;
    try {
      await api.restoreDatabase(file);
      toast().show(t("toast.restoreDone"));
      // reload all data into the store after restore
      await Promise.all([
        useSkillsStore.getState().loadSkills(),
        useAssetsStore.getState().loadPrompts(),
        useAssetsStore.getState().loadRules(),
        usePackagesStore.getState().loadPackages(),
        useExtensionsStore.getState().loadExtensions(),
        useWorkspaceStore.getState().loadAgents(),
        useWorkspaceStore.getState().loadProjects(),
        useWorkspaceStore.getState().loadLibrarySources(),
        useSkillsStore.getState().loadAgentOptions(),
        useActivityStore.getState().loadActivity(),
      ]);
    } catch { toast().show(t("toast.restoreFailed"), "error"); }
  };

  const themes: { id: "light" | "dark" | "system"; icon: React.ReactNode; labelKey: TranslationKey }[] = [
    { id: "light", icon: <Sun size={14} />, labelKey: "settings.light" },
    { id: "dark", icon: <Moon size={14} />, labelKey: "settings.dark" },
    { id: "system", icon: <Monitor size={14} />, labelKey: "settings.system" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title={t("settings.title")} />
      <div className="settings-view">
        <div className="settings-view__inner mx-auto w-full max-w-5xl px-6 py-6">
        <div className="settings-grid">
        {/* General */}
        <Section icon={<Power size={14} />} title={t("settings.general")}>
          <Row label={t("settings.launchAtLogin")} desc={t("settings.launchAtLoginDesc")}>
            <Toggle checked={autostart} onChange={toggleAutostart} />
          </Row>
          <Row label={t("settings.language")}>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLang(l.id as Lang)}
                  className={"px-3 py-1 text-xs rounded-md transition-colors " +
                    (lang === l.id
                      ? "bg-accent text-accent-fg"
                      : "text-muted hover:text-content dark:hover:text-faint")}
                >
                  {t(l.labelKey)}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Appearance */}
        <Section icon={<Palette size={14} />} title={t("settings.appearance")}>
          <Row label={t("settings.theme")}>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {themes.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setTheme(o.id)}
                  className={"flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors " +
                    (theme === o.id
                      ? "bg-accent text-accent-fg"
                      : "text-muted hover:text-content dark:hover:text-faint")}
                >
                  {o.icon} {t(o.labelKey)}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Data */}
        <Section icon={<Database size={14} />} title={t("settings.data")}>
          <div className="py-1.5 space-y-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted">{t("settings.githubToken")}</p>
              <p className="text-[13px] text-faint mt-0.5 leading-relaxed">{t("settings.githubTokenDesc")}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
                className="input w-[220px]"
              />
              <button
                onClick={saveGithubToken}
                disabled={tokenSaving}
                className="btn btn-outline"
              >
                {tokenSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                {t("settings.tokenSave")}
              </button>
            </div>
          </div>
          <Row label={t("settings.backup")} desc={t("settings.backupDesc")}>
            <button onClick={handleBackup}
              className="btn btn-outline">
              <Download size={14} /> {t("settings.backup")}
            </button>
          </Row>
          <Row label={t("settings.restore")} desc={t("settings.restoreDesc")}>
            <button onClick={handleRestore}
              className="btn btn-outline">
              <Upload size={14} /> {t("settings.restore")}
            </button>
          </Row>
        </Section>

        {/* About */}
        <Section
          icon={<Info size={14} />}
          title={t("settings.about")}
          className="settings-grid__wide"
          action={
            // 互斥显示：有可用更新时右上角固定为「更新到 vX.Y.Z」入口，
            // 否则是「检查更新」；更新动作统一走弹窗（进度 + 自动重启）
            update && !checking ? (
              <button
                onClick={() => setUpdateDialogOpen(true)}
                className="btn btn-primary btn-sm"
                title={t("settings.newVersionAvailable", { version: update.version })}
              >
                <Download size={13} /> {t("settings.updateToVersion", { version: update.version })}
              </button>
            ) : (
              <button onClick={handleCheckUpdate} disabled={checking} className="btn btn-outline btn-sm">
                {checking ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
                {t("settings.checkUpdate")}
              </button>
            )
          }
        >
          <div className="space-y-2.5 text-xs">
            <KV label={t("settings.projectName")} value="SkillDeck" />
            <KV label={t("settings.version")} value={appInfo?.version ?? "—"} />
            <p className="text-muted leading-relaxed pt-1">
              {t("settings.appDescription")}
            </p>
          </div>
        </Section>

        </div>
      </div>
      </div>

      <UpdateDialog
        open={updateDialogOpen && !!update}
        update={update}
        phase={updatePhase}
        progress={progress}
        onClose={() => setUpdateDialogOpen(false)}
        onDownload={handleDownloadUpdate}
      />
    </div>
  );
}

// ---- small building blocks ----

function Section({
  icon,
  title,
  children,
  className = "",
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`card overflow-hidden settings-section ${className}`}>
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border-subtle bg-surface-2/40 shrink-0">
        <span className="flex items-center justify-center w-7 h-7 rounded-md border border-border-subtle text-muted bg-surface shrink-0">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        {action && <div className="ml-auto shrink-0 flex items-center">{action}</div>}
      </header>
      <div className="settings-section__body flex flex-col justify-center px-5 py-3 divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">{label}</p>
        {desc && <p className="text-[13px] text-faint mt-0.5">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted w-20 shrink-0">{label}</span>
      <span className={"text-muted " + (mono ? "font-mono text-[13px] break-all" : "")}>{value}</span>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={"relative w-9 h-5 rounded-full transition-colors " +
        (checked ? "bg-accent dark:bg-accent-inverse" : "bg-surface-hover")}
    >
      <span className={"absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform " +
        (checked ? "translate-x-4" : "")} />
    </button>
  );
}

/** 检查到新版本后的更新弹窗：确认下载 → 进度条 → 完成自动重启 */
function UpdateDialog({
  open, update, phase, progress, onClose, onDownload,
}: {
  open: boolean;
  update: api.Update | null;
  phase: "idle" | "downloading" | "restarting";
  progress: number;
  onClose: () => void;
  onDownload: () => void;
}) {
  const t = useT();
  if (!open || !update) return null;
  const busy = phase !== "idle";
  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" data-testid="update-dialog" className="connection-dialog">
        <div className="connection-dialog-icon">
          <Download size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="connection-dialog-title">
            {t("settings.newVersionAvailable", { version: update.version })}
          </h3>

          {phase === "restarting" ? (
            <p className="connection-dialog-message flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> {t("settings.updateReady")}
            </p>
          ) : phase === "downloading" ? (
            <div className="space-y-1.5">
              <p className="connection-dialog-message" style={{ margin: 0 }}>
                {t("settings.downloading", { percent: progress })}
              </p>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-normal"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="connection-dialog-message">{t("settings.updateDialogDesc")}</p>
          )}

          <div className="connection-dialog-actions">
            {!busy && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
                {t("settings.updateLater")}
              </button>
            )}
            {phase === "idle" && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onDownload}>
                <Download size={13} /> {t("settings.downloadInstall")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
