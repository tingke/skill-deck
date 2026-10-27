import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderInput,
  GitBranch,
  Loader2,
  Package,
  TriangleAlert,
} from "lucide-react";
import type {
  AuditFinding,
  InstallResult,
  LibrarySource,
  MarketplaceSkill,
  ProjectRow,
  Skill,
  SkillSourceKind,
  SkillSourceInput,
} from "../../types";
import {
  getProjects,
  installSkill,
  installSkillToDir,
  pickSkillArchive,
  pickSkillFolder,
} from "../../lib/tauri";
import { mergeFindings, ruleExplanation } from "../../lib/skillAudit";
import { useSkillsStore } from "../../stores/skills";
import { useUiStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { useT } from "../../i18n";

const toast = () => useToastStore.getState();

/** 跳到「技能」页并选中技能，完成「装好 → 启用」闭环 */
function goToSkill(skillId: string | null | undefined) {
  if (!skillId) return;
  useUiStore.getState().setView("skills");
  useSkillsStore.getState().selectSkill(skillId);
}

function findLocalSkill(skills: Skill[], entry: MarketplaceSkill): Skill | null {
  const name = entry.name.trim().toLowerCase();
  return skills.find((skill) => skill.name.trim().toLowerCase() === name) ?? null;
}

/** 安装来源：商店条目直接携带 source；自定义来源由表单构造 */
export type InstallTarget =
  | { mode: "entry"; entry: MarketplaceSkill }
  | { mode: "custom" };

/** 自定义来源两类：GitHub 仓库 / 本地文件（zip 或文件夹） */
type CustomTab = "github" | "local";

/** 安装位置选项：主库（库源）/ 项目 / 自定义目录 */
type LocationChoice =
  | { type: "library"; id: string }
  | { type: "project"; path: string }
  | { type: "custom"; path: string };

const LOCATION_LIBRARY = "__library__";
const LOCATION_PROJECT_PREFIX = "project:";
const LOCATION_CUSTOM = "__custom__";

export default function SkillInstallDialog({
  target,
  libraries,
  skills,
  onClose,
  onInstalled,
}: {
  target: InstallTarget | null;
  libraries: LibrarySource[];
  skills: Skill[];
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const t = useT();
  const entry = target?.mode === "entry" ? target.entry : null;
  const isCustom = target?.mode === "custom";
  const [tab, setTab] = useState<CustomTab>("github");
  const [sourceRef, setSourceRef] = useState("");
  const [subdir, setSubdir] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [location, setLocation] = useState<string>("");
  const [customDir, setCustomDir] = useState("");
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  // 本地文件 Tab 下从输入推导安装来源类型（zip 或目录）
  const localKind: SkillSourceKind = sourceRef.trim().toLowerCase().endsWith(".zip")
    ? "archive"
    : "path";

  useEffect(() => {
    if (!target) {
      setResult(null);
      setRiskConfirmed(false);
      setSourceRef("");
      setSubdir("");
      setShowAdvanced(false);
      setCustomDir("");
      return;
    }
    setResult(null);
    setRiskConfirmed(false);
    if (target.mode === "custom") {
      setSourceRef("");
      setSubdir("");
      setTab("github");
    }
    if (libraries.length > 0) {
      setLocation((current) =>
        current.startsWith(LOCATION_PROJECT_PREFIX) || current === LOCATION_CUSTOM
          ? current
          : LOCATION_LIBRARY,
      );
    }
    getProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const locationChoice: LocationChoice | null = useMemo(() => {
    if (location === LOCATION_LIBRARY && libraries.length > 0) {
      return { type: "library", id: libraries[0].id };
    }
    if (location.startsWith(LOCATION_PROJECT_PREFIX)) {
      const projectId = location.slice(LOCATION_PROJECT_PREFIX.length);
      const project = projects.find((item) => item.id === projectId);
      if (project) return { type: "project", path: `${project.path}/.agents/skills` };
    }
    if (location === LOCATION_CUSTOM && customDir.trim()) {
      return { type: "custom", path: customDir.trim() };
    }
    return null;
  }, [location, libraries, projects, customDir]);

  if (!target) return null;

  const canInstall = entry
    ? Boolean(locationChoice)
    : tab === "github"
      ? Boolean(sourceRef.trim() && locationChoice)
      : Boolean(sourceRef.trim() && locationChoice);

  const pickLocal = async (kind: "archive" | "path") => {
    const picked = kind === "archive" ? await pickSkillArchive() : await pickSkillFolder();
    if (picked) setSourceRef(picked);
  };

  const runInstall = async (overrideAudit: boolean) => {
    if (installing || !locationChoice) return;
    const source: SkillSourceInput = entry
      ? { kind: "git", source_ref: entry.source.source_ref, subdir: entry.source.subdir ?? null }
      : tab === "github"
        ? {
            kind: "git",
            source_ref: sourceRef.trim(),
            subdir: subdir.trim() ? subdir.trim() : null,
          }
        : {
            kind: localKind,
            source_ref: sourceRef.trim(),
            subdir: null,
          };
    setInstalling(true);
    try {
      const installResult =
        locationChoice.type === "library"
          ? await installSkill(source, locationChoice.id, overrideAudit)
          : await installSkillToDir(
              source,
              locationChoice.path,
              overrideAudit,
            );
      setResult(installResult);
      if (installResult.status === "installed") {
        await onInstalled();
      }
    } catch (error) {
      toast().show(String(error), "error");
    } finally {
      setInstalling(false);
    }
  };

  const status = result?.status;
  const findings: AuditFinding[] = result?.report?.findings ?? [];
  const needsRiskConfirm = status === "audit_warned";

  return (
    <div className="connection-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !installing) onClose();
    }}>
      <div role="dialog" aria-modal="true" className="install-dialog" data-testid="market-install-skill-dialog">
        <div className="flex items-start gap-2.5 mb-3.5 pr-7">
          <div className="connection-dialog-icon bg-accent-soft text-accent">
            <BookOpen size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="connection-dialog-title">
              {entry
                ? t("market.dlgInstallTitle", { name: entry.name })
                : t("market.customTitle")}
            </h3>
            <p className="connection-dialog-message truncate" title={entry?.source.source_ref}>
              {entry
                ? t("market.dlgFrom", { source: entry.source.source_ref, author: entry.author || "—" })
                : t("market.customDesc")}
            </p>
          </div>
        </div>

        {!result && (
          <>
            {isCustom && (
              <>
                {/* 来源两类：GitHub / 本地文件 */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {(
                    [
                      { id: "github", label: t("market.tabGithub"), icon: <GitBranch size={13} /> },
                      { id: "local", label: t("market.tabLocal"), icon: <FolderInput size={13} /> },
                    ] as { id: CustomTab; label: string; icon: React.ReactNode }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={"btn btn-sm " + (tab === item.id ? "btn-primary" : "btn-outline")}
                    >
                      {item.icon} {item.label}
                    </button>
                  ))}
                </div>

                {tab === "github" ? (
                  <>
                    <input
                      value={sourceRef}
                      onChange={(event) => setSourceRef(event.target.value)}
                      placeholder={t("market.githubPlaceholder")}
                      spellCheck={false}
                      className="input font-mono"
                      autoFocus
                    />
                    {/* 高级选项：仓库子路径，默认收起 */}
                    <button
                      type="button"
                      className="flex items-center gap-1.5 w-full mt-2 px-2.5 py-1.5 rounded-lg border border-dashed border-border-strong text-2xs text-faint hover:text-muted"
                      onClick={() => setShowAdvanced((current) => !current)}
                    >
                      {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {t("market.advancedOptions")}
                    </button>
                    {showAdvanced && (
                      <input
                        value={subdir}
                        onChange={(event) => setSubdir(event.target.value)}
                        placeholder={t("market.customSubdir")}
                        spellCheck={false}
                        className="input font-mono mt-2"
                      />
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        value={sourceRef}
                        onChange={(event) => setSourceRef(event.target.value)}
                        placeholder={t("market.localPlaceholder")}
                        spellCheck={false}
                        className="input font-mono"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm shrink-0"
                        onClick={() => pickLocal("archive")}
                      >
                        <Package size={13} /> {t("market.pickZip")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm shrink-0"
                        onClick={() => pickLocal("path")}
                      >
                        <FolderInput size={13} /> {t("market.pickFolder")}
                      </button>
                    </div>
                    {sourceRef.trim() && (
                      <p className="text-2xs text-faint mt-1.5">
                        {localKind === "archive" ? t("market.localKindZip") : t("market.localKindFolder")}
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* 安装位置：主库 / 项目 / 自定义 */}
            <label className="block space-y-1 mt-3.5 mb-1">
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.dlgLocation")}</span>
              <select value={location} onChange={(event) => setLocation(event.target.value)} className="input">
                <option value={LOCATION_LIBRARY}>
                  {libraries[0] ? t("market.locationMainLibrary", { name: libraries[0].name }) : t("market.locationMainLibraryFallback")}
                </option>
                {projects.length > 0 && (
                  <optgroup label={t("market.locationProjects")}>
                    {projects.map((project) => (
                      <option key={project.id} value={LOCATION_PROJECT_PREFIX + project.id}>
                        {project.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={LOCATION_CUSTOM}>{t("market.locationCustom")}</option>
              </select>
              {location === LOCATION_CUSTOM && (
                <input
                  value={customDir}
                  onChange={(event) => setCustomDir(event.target.value)}
                  placeholder={t("market.locationCustomPlaceholder")}
                  spellCheck={false}
                  className="input font-mono mt-1.5"
                />
              )}
              <span className="block text-2xs text-faint leading-relaxed mt-1">
                {locationChoice?.type === "project"
                  ? t("market.locationProjectTip")
                  : locationChoice?.type === "custom"
                    ? t("market.locationCustomTip")
                    : t("market.dlgLocationTip")}
              </span>
            </label>
            <div className="connection-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => runInstall(false)}
                disabled={installing || !canInstall}
              >
                {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {installing ? t("market.dlgInstalling") : t("market.dlgInstallBtn")}
              </button>
            </div>
          </>
        )}

        {status === "installed" && result && (
          <SuccessPanel
            title={t("market.dlgSuccessTitle")}
            desc={t("market.dlgSuccessDesc")}
            primaryLabel={t("market.dlgGoConnect")}
            secondaryLabel={t("market.dlgLater")}
            onPrimary={() => {
              goToSkill(result.skill_id);
              onClose();
            }}
            onSecondary={onClose}
          />
        )}

        {status === "conflict" && result && (
          <SuccessPanel
            title={t("market.dlgConflictTitle")}
            desc={t("market.dlgConflictDesc")}
            primaryLabel={t("market.enable")}
            secondaryLabel={t("common.close")}
            onPrimary={() => {
              // 冲突结果不带 skill_id；商店条目按名称找本机已有技能，自定义来源直接关闭
              goToSkill(result.skill_id ?? (entry ? findLocalSkill(skills, entry)?.id : null));
              onClose();
            }}
            onSecondary={onClose}
          />
        )}

        {status === "audit_blocked" && (
          <>
            <StepLabel>{t("market.dlgStep1Issues")}</StepLabel>
            <CheckPanel tone="danger" icon={<TriangleAlert size={16} />}>
              <CheckPanelTitle tone="danger">{t("market.dlgBlockedTitle")}</CheckPanelTitle>
              <p className="text-2xs text-muted leading-relaxed mt-0.5">{t("market.dlgBlockedDesc")}</p>
            </CheckPanel>
            <RiskFindings findings={findings} />
            <div className="connection-dialog-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={onClose} autoFocus>
                {t("market.dlgBack")}
              </button>
            </div>
          </>
        )}

        {needsRiskConfirm && (
          <>
            <StepLabel>{t("market.dlgStep1Issues")}</StepLabel>
            <CheckPanel tone="warn" icon={<TriangleAlert size={16} />}>
              <CheckPanelTitle tone="warn">
                {t("market.dlgCheckIssuesTitle", { count: findings.length })}
              </CheckPanelTitle>
              <p className="text-2xs text-muted leading-relaxed mt-0.5">{t("market.dlgCheckIssuesDesc")}</p>
            </CheckPanel>
            <RiskFindings findings={findings} />
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={riskConfirmed}
                onChange={(event) => setRiskConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span className="text-2xs text-muted leading-relaxed">{t("market.dlgRiskConfirm")}</span>
            </label>
            <div className="connection-dialog-actions" style={{ justifyContent: "space-between" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing}>
                {t("market.dlgBack")}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={!riskConfirmed || installing}
                onClick={() => runInstall(true)}
              >
                {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {t("market.dlgInstallAnyway")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type PanelTone = "ok" | "warn" | "danger" | "pending";

const PANEL_TONE_CLASSES: Record<PanelTone, string> = {
  ok: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800",
  warn: "bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800",
  danger: "bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800",
  pending: "bg-surface-2 border-border-subtle",
};

const PANEL_TITLE_CLASSES: Record<PanelTone, string> = {
  ok: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  danger: "text-red-600 dark:text-red-300",
  pending: "text-muted",
};

/** 分区小标题（安装向导步骤标签） */
export function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs font-semibold text-faint uppercase tracking-wider mb-1.5">{children}</div>
  );
}

/** 色调面板（安全检查 / 风险 / 成功提示共用） */
export function CheckPanel({
  tone,
  icon,
  children,
}: {
  tone: PanelTone;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={"rounded-lg border p-3 flex gap-2.5 mb-3 " + PANEL_TONE_CLASSES[tone]}>
      <span className={"shrink-0 mt-0.5 " + PANEL_TITLE_CLASSES[tone]}>{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function CheckPanelTitle({ tone, children }: { tone: PanelTone; children: React.ReactNode }) {
  return (
    <div className={"text-xs font-semibold " + PANEL_TITLE_CLASSES[tone]}>{children}</div>
  );
}

/** 风险条目：相同检查项合并展示，白话标题 + 「这是什么意思？」展开（规则编号与位置收进展开层） */
function RiskFindings({ findings }: { findings: AuditFinding[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const merged = mergeFindings(findings);
  return (
    <div className="space-y-2">
      {merged.map((finding, index) => {
        const key = `${finding.rule_id}-${index}`;
        const explanation = ruleExplanation(finding.rule_id);
        const open = expanded[key];
        return (
          <div key={key} className="rounded-lg border border-border-subtle bg-surface p-2.5">
            <div className="flex items-start gap-2">
              <TriangleAlert size={13} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="text-xs text-content leading-relaxed flex-1">{finding.message}</span>
              {finding.count > 1 && (
                <span className="text-2xs text-faint shrink-0 mt-0.5">
                  {t("market.dlgFindingCount", { count: finding.count })}
                </span>
              )}
            </div>
            {(explanation || finding.locations.length > 0) && (
              <button
                type="button"
                className="flex items-center gap-1 text-2xs text-accent mt-1.5 ml-5"
                onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
              >
                {t("market.dlgWhatMean")}
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            )}
            {open && (
              <div className="ml-5 mt-1.5 rounded bg-surface-2 p-2 text-2xs text-muted leading-relaxed">
                {explanation}
                <div className="text-faint font-mono mt-1 space-y-0.5">
                  <div>{t("market.dlgRuleRef", { id: finding.rule_id })}</div>
                  {finding.locations.map((location) => (
                    <div key={location} className="truncate" title={location}>{location}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuccessPanel({
  title,
  desc,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  title: string;
  desc: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <>
      <CheckPanel tone="ok" icon={<Check size={16} />}>
        <CheckPanelTitle tone="ok">{title}</CheckPanelTitle>
        <p className="text-2xs text-muted leading-relaxed mt-0.5">{desc}</p>
      </CheckPanel>
      <div className="connection-dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSecondary}>
          {secondaryLabel}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onPrimary}>
          {primaryLabel} <ArrowRight size={12} />
        </button>
      </div>
    </>
  );
}
