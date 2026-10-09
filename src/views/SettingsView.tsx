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
import { formatSkillPath } from "../lib/skillPaths";
import type { AppInfo } from "../types";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";
import {
  Sun, Moon, Monitor, Palette, Database, Info,
  Power, Download, Upload, CheckCircle2, Globe,
  FolderOpen, Loader2, FolderTree, Plus, Trash2, Folder, X,
} from "lucide-react";

const toast = () => useToastStore.getState();


// ===================== Library Sources Management =====================

function LibrarySourceRow({
  lib, skillCount, homeDirectory, onToggle, onDelete,
}: {
  lib: import("../types").LibrarySource;
  skillCount: number;
  homeDirectory: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const shortPath = lib.path.startsWith("/")
    ? formatSkillPath(lib.path, homeDirectory)
    : `~/${lib.path}`;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Folder size={14} className="text-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-content">{lib.name}</div>
        <div className="text-[13px] text-faint font-mono truncate">{shortPath}</div>
      </div>
      <span className={"text-[12px] font-mono px-2 py-0.5 rounded-full shrink-0 " +
        (lib.enabled ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" : "bg-surface-2 text-faint")}>
        {t("settings.libs.skillCount", { count: skillCount })}
      </span>
      <button
        onClick={onToggle}
        className={"relative w-9 h-5 rounded-full transition-colors shrink-0 " +
          (lib.enabled ? "bg-accent dark:bg-accent-inverse" : "bg-surface-hover")}
      >
        <span className={"absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform " +
          (lib.enabled ? "translate-x-4" : "")} />
      </button>
      <button
        onClick={onDelete}
        className="text-red-500 hover:text-red-600 shrink-0 p-1"
        title={t("common.delete")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function LibrarySourcesSection() {
  const t = useT();
  const { librarySources, loadLibrarySources } = useWorkspaceStore();
  const { skills, loadSkills, scanNow } = useSkillsStore();
  const deleteConfirmation = useDeleteConfirmation();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [homeDirectory, setHomeDirectory] = useState("");
  useEffect(() => {
    api.getHomeDirectory().then(setHomeDirectory).catch(() => {});
  }, []);

  const countForLib = (libName: string) =>
    skills.filter((s) => s.source_lib === libName).length;

  const handlePickFolder = async () => {
    const dir = await api.pickFolder();
    if (dir) {
      const home = formatSkillPath(dir, homeDirectory);
      setNewPath(home);
      if (!newName) {
        const parts = home.split("/");
        setNewName(parts[parts.length - 1] || t("settings.libs.defaultName"));
      }
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newPath.trim()) return;
    // 后端约定：以 "/" 开头视为绝对路径，否则按 home 相对解析。
    // "~/xxx" 归一化为 "xxx"（home 相对），其余输入原样保留。
    const normalized = newPath.trim() === "~" ? "" : newPath.trim().replace(/^~\/?/, "");
    if (!normalized) {
      toast().show(t("settings.libs.invalidPath"), "error");
      return;
    }
    let id = newName.trim().toLowerCase().replace(/\s+/g, "-");
    // 同名库源：派生唯一 id，避免 UPSERT 静默覆盖已有库源
    if (librarySources.some((l) => l.id === id)) {
      id = `${id}-${Date.now().toString(36)}`;
    }
    try {
      await api.saveLibrarySource({
        id,
        name: newName.trim(),
        path: normalized,
        enabled: true,
        sort_order: librarySources.length,
      });
      await scanNow();
      await loadLibrarySources();
      setAdding(false);
      setNewName("");
      setNewPath("");
      toast().show(t("settings.libs.added"));
    } catch (e) {
      // 后端会返回具体的校验失败原因（如与项目目录重叠），优先展示
      const detail = typeof e === "string" && e.trim() ? e : t("settings.libs.addFailed");
      toast().show(detail, "error");
    }
  };

  const handleToggle = async (lib: import("../types").LibrarySource) => {
    try {
      await api.saveLibrarySource({ ...lib, enabled: !lib.enabled });
      await scanNow();
      await loadLibrarySources();
      toast().show(lib.enabled ? t("settings.libs.disabled") : t("settings.libs.enabled"));
    } catch {
      toast().show(t("common.operationFailed"), "error");
    }
  };

  const handleDelete = async (lib: import("../types").LibrarySource) => {
    try {
      await api.deleteLibrarySource(lib.id);
      await scanNow();
      await loadLibrarySources();
      toast().show(t("settings.libs.deleted"));
    } catch {
      toast().show(t("settings.libs.deleteFailed"), "error");
    }
  };

  return (
    <Section
      icon={<FolderTree size={14} />}
      title={t("settings.libs.title")}
      action={
        <button onClick={() => setAdding(true)} className="btn-icon" title={t("settings.libs.add")}>
          <Plus size={14} />
        </button>
      }
    >
      <p className="text-[13px] text-faint pb-3">{t("settings.libs.desc")}</p>
      <div className="divide-y divide-border-subtle">
        {librarySources.map((lib) => (
          <LibrarySourceRow
            key={lib.id}
            lib={lib}
            skillCount={countForLib(lib.name)}
            homeDirectory={homeDirectory}
            onToggle={() => handleToggle(lib)}
            onDelete={() =>
              deleteConfirmation.request(lib.name, () => handleDelete(lib), t("settings.libs.deleteWarning"))
            }
          />
        ))}
        {librarySources.length === 0 && (
          <p className="text-xs text-faint py-4 text-center">{t("settings.libs.empty")}</p>
        )}
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setAdding(false); setNewName(""); setNewPath(""); }}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-surface rounded-2xl shadow-2xl w-[440px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
              <h3 className="text-sm font-bold">{t("settings.libs.add")}</h3>
              <button
                onClick={() => { setAdding(false); setNewName(""); setNewPath(""); }}
                className="btn-icon"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[13px] text-faint mb-1 block">{t("settings.libs.nameLabel")}</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("settings.libs.namePlaceholder")}
                  className="input"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[13px] text-faint mb-1 block">{t("settings.libs.pathLabel")}</label>
                <div className="flex items-center gap-2">
                  <input
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder={t("settings.libs.pathPlaceholder")}
                    className="input flex-1 font-mono"
                  />
                  <button onClick={handlePickFolder} className="btn btn-outline btn-sm shrink-0">
                    <FolderOpen size={13} /> {t("settings.libs.pick")}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
              <button
                onClick={() => { setAdding(false); setNewName(""); setNewPath(""); }}
                className="btn btn-ghost"
              >
                {t("common.cancel")}
              </button>
              <button onClick={handleAdd} disabled={!newName.trim() || !newPath.trim()} className="btn btn-primary">
                <Plus size={13} /> {t("settings.libs.addBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-library-source-dialog" />
    </Section>
  );
}

export default function SettingsView() {
  const t = useT();
  const { theme, setTheme } = useUiStore();
  const { librarySources, loadLibrarySources } = useWorkspaceStore();
  const { skills, loadSkills } = useSkillsStore();

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

  // App info + update
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<api.Update | null>(null);
  const [updatePhase, setUpdatePhase] = useState<"idle" | "downloading" | "downloaded">("idle");
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
      if (!found) toast().show(t("settings.upToDate"));
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
    if (!update) return;
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
      setUpdatePhase("downloaded");
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
    <div className="settings-view bg-page">
      <div className="settings-view__inner mx-auto w-full max-w-5xl px-6 py-6">
        <h2 className="text-lg font-bold mb-5">{t("settings.title")}</h2>

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

        {/* Library Sources */}
        <LibrarySourcesSection />

        {/* Data */}
        <Section icon={<Database size={14} />} title={t("settings.data")}>
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
            <button onClick={handleCheckUpdate} disabled={checking} className="btn btn-outline btn-sm">
              {checking ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
              {t("settings.checkUpdate")}
            </button>
          }
        >
          <div className="space-y-2.5 text-xs">
            <KV label={t("settings.projectName")} value="SkillDeck" />
            <KV label={t("settings.version")} value={appInfo?.version ?? "—"} />
            <p className="text-muted leading-relaxed pt-1">
              {t("settings.appDescription")}
            </p>
            {update && !checking && (
              <div className="pt-1">
                <UpdateResult
                  update={update}
                  phase={updatePhase}
                  progress={progress}
                  t={t}
                  onDownload={handleDownloadUpdate}
                  onRestart={() => { api.relaunchApp(); }}
                />
              </div>
            )}
          </div>
        </Section>

        </div>
      </div>
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
      <div className="settings-section__body px-5 py-3 divide-y divide-border-subtle">{children}</div>
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

function UpdateResult({
  update, phase, progress, t, onDownload, onRestart,
}: {
  update: api.Update;
  phase: "idle" | "downloading" | "downloaded";
  progress: number;
  t: (k: TranslationKey, v?: Record<string, string | number>) => string;
  onDownload: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[13px] text-blue-600 dark:text-blue-400">
        {t("settings.newVersionAvailable", { version: update.version })}
      </span>
      {phase === "downloaded" ? (
        <button onClick={onRestart} className="btn btn-outline btn-sm">
          <CheckCircle2 size={13} /> {t("settings.restartToUpdate")}
        </button>
      ) : (
        <button onClick={onDownload} disabled={phase === "downloading"} className="btn btn-outline btn-sm">
          {phase === "downloading" ? (
            <>
              <Loader2 size={13} className="animate-spin" /> {t("settings.downloading", { percent: progress })}
            </>
          ) : (
            <>{t("settings.downloadInstall")}</>
          )}
        </button>
      )}
    </div>
  );
}
