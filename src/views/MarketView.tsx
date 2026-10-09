import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import type {
  AgentInfo,
  AuditFinding,
  ExtensionRow,
  InstallResult,
  LibrarySource,
  MarketplaceMcp,
  MarketplaceSkill,
  Skill,
} from "../types";
import { installSkill, saveMcpCmd } from "../lib/tauri";
import {
  DEFAULT_MCP_REGISTRY_URL,
  applyRequiredInputs,
  filterMarketplaceItems,
  marketplaceItems,
  parseMarketplaceMcpConfig,
  type MarketplaceKind,
} from "../lib/marketplace";
import { mergeFindings, ruleExplanation } from "../lib/skillAudit";
import { useSkillsStore } from "../stores/skills";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import { useExtensionsStore } from "../stores/extensions";
import { useActivityStore } from "../stores/activity";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useMarketplaceStore } from "../stores/marketplace";

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

export default function MarketView() {
  const t = useT();
  const skills = useSkillsStore((state) => state.skills);
  const loadSkills = useSkillsStore((state) => state.loadSkills);
  const loadAgentOptions = useSkillsStore((state) => state.loadAgentOptions);
  const agentOptions = useSkillsStore((state) => state.agentOptions);
  const librarySources = useWorkspaceStore((state) => state.librarySources);
  const loadLibrarySources = useWorkspaceStore((state) => state.loadLibrarySources);
  const extensions = useExtensionsStore((state) => state.extensions);
  const loadExtensions = useExtensionsStore((state) => state.loadExtensions);
  const loadActivity = useActivityStore((state) => state.loadActivity);

  const sourceMode = useMarketplaceStore((state) => state.sourceMode);
  const manifestUrl = useMarketplaceStore((state) => state.manifestUrl);
  const catalog = useMarketplaceStore((state) => state.catalog);
  const syncing = useMarketplaceStore((state) => state.syncing);
  const setSourceMode = useMarketplaceStore((state) => state.setSourceMode);
  const setManifestUrl = useMarketplaceStore((state) => state.setManifestUrl);
  const syncMarket = useMarketplaceStore((state) => state.sync);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MarketplaceKind>("all");
  const [skillEntry, setSkillEntry] = useState<MarketplaceSkill | null>(null);
  const [mcpEntry, setMcpEntry] = useState<MarketplaceMcp | null>(null);

  useEffect(() => {
    (async () => {
      await Promise.all([
        loadSkills(),
        loadAgentOptions(),
        loadLibrarySources(),
        loadExtensions(),
      ]);
    })();
  }, [loadSkills, loadAgentOptions, loadLibrarySources, loadExtensions]);

  const items = useMemo(() => marketplaceItems(catalog), [catalog]);
  const filtered = useMemo(
    () => filterMarketplaceItems(items, { query, kind, tag: null }),
    [items, query, kind],
  );

  const openMcp = (entry: MarketplaceMcp) => {
    setMcpEntry(entry);
  };

  const catalogTime = useMemo(() => {
    if (!catalog) return "";
    const date = new Date(catalog.synced_at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [catalog]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="market-view">
      {!catalog ? (
        <EmptyMarket
          syncing={syncing}
          onBrowse={() => {
            if (sourceMode !== "registry") setSourceMode("registry");
            syncMarket();
          }}
          onUseCustom={(url) => {
            setManifestUrl(url);
            setSourceMode("custom");
          }}
        />
      ) : (
        <>
          <div className="flex items-start gap-3 px-6 py-3 border-b border-border bg-surface">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-content dark:text-heading">{t("market.title")}</h2>
              <p className="text-2xs text-faint mt-0.5">{t("market.desc")}</p>
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSourceMode("registry")}
                  className={"btn btn-sm border-0 " + (sourceMode === "registry" ? "btn-primary" : "btn-ghost")}
                >
                  {t("market.sourceRegistry")}
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("custom")}
                  className={"btn btn-sm border-0 " + (sourceMode === "custom" ? "btn-primary" : "btn-ghost")}
                >
                  {t("market.sourceCustom")}
                </button>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={syncMarket} disabled={syncing}>
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {syncing ? t("market.syncing") : t("market.refresh")}
              </button>
            </div>
          </div>

          <div className="border-b border-border-subtle bg-surface px-6 py-3 space-y-3">
            {sourceMode === "custom" && (
              <div className="space-y-1.5">
                <input
                  value={manifestUrl}
                  onChange={(event) => setManifestUrl(event.target.value)}
                  placeholder={t("market.manifestPlaceholder")}
                  spellCheck={false}
                  className="input font-mono"
                />
                <p className="text-2xs text-faint">{t("market.customHint")}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("market.searchPlaceholder")}
                  className="input pl-8"
                />
              </div>
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                {(["all", "skill", "mcp"] as MarketplaceKind[]).map((itemKind) => (
                  <button
                    key={itemKind}
                    type="button"
                    onClick={() => setKind(itemKind)}
                    className={"btn btn-sm border-0 " + (kind === itemKind ? "btn-primary" : "btn-ghost")}
                  >
                    {itemKind === "all"
                      ? t("market.all", { count: items.length })
                      : itemKind === "skill"
                        ? t("market.skills", { count: catalog?.skills.length ?? 0 })
                        : t("market.mcps", { count: catalog?.mcps.length ?? 0 })}
                  </button>
                ))}
              </div>
              {catalogTime && (
                <span className="text-2xs text-faint shrink-0">{t("market.updatedAt", { time: catalogTime })}</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-page p-4">
            {filtered.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-faint">
                <Search size={40} className="opacity-30" />
                <p className="text-sm mt-2">{t("market.noMatch")}</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((item) => (
                  <MarketCard
                    key={`${item.kind}:${item.entry.id}`}
                    item={item}
                    skills={skills}
                    extensions={extensions}
                    onInstallSkill={setSkillEntry}
                    onOpenMcp={openMcp}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <SkillInstallDialog
        entry={skillEntry}
        libraries={librarySources.filter((library) => library.enabled)}
        skills={skills}
        onClose={() => setSkillEntry(null)}
        onInstalled={async () => {
          await Promise.all([loadSkills(), loadActivity()]);
        }}
      />
      <McpInstallDialog
        entry={mcpEntry}
        agents={agentOptions}
        extensions={extensions}
        onClose={() => setMcpEntry(null)}
        onDone={async () => {
          await Promise.all([loadExtensions(), loadActivity()]);
        }}
      />
    </div>
  );
}

// ===================== 空态引导 =====================

function EmptyMarket({
  syncing,
  onBrowse,
  onUseCustom,
}: {
  syncing: boolean;
  onBrowse: () => void;
  onUseCustom: (url: string) => void;
}) {
  const t = useT();
  const { manifestUrl, setManifestUrl } = useMarketplaceStore();
  const [addingCustom, setAddingCustom] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto bg-page">
      <div className="max-w-[620px] mx-auto text-center pt-14">
        <div className="w-14 h-14 rounded-2xl bg-accent-soft text-accent flex items-center justify-center mx-auto">
          <Store size={26} />
        </div>
        <h2 className="text-lg font-bold text-heading mt-3">{t("market.emptyTitle")}</h2>
        <p className="text-xs text-muted mt-1.5 leading-relaxed">{t("market.emptyDesc")}</p>

        <div className="grid grid-cols-2 gap-3 mt-5 text-left">
          <div className="card p-3.5 flex gap-2.5">
            <BookOpen size={17} className="text-accent shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-heading">{t("market.emptyConceptSkillTitle")}</div>
              <p className="text-2xs text-muted mt-0.5 leading-relaxed">{t("market.emptyConceptSkillDesc")}</p>
            </div>
          </div>
          <div className="card p-3.5 flex gap-2.5">
            <Plug size={17} className="text-accent shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-heading">{t("market.emptyConceptToolTitle")}</div>
              <p className="text-2xs text-muted mt-0.5 leading-relaxed">{t("market.emptyConceptToolDesc")}</p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <button type="button" className="btn btn-primary btn-lg" onClick={onBrowse} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("market.emptyBrowse")} <ArrowRight size={14} />
          </button>
          <p className="text-2xs text-faint mt-2.5 leading-relaxed">{t("market.emptyPrivacy")}</p>
        </div>

        <div className="mt-5 pb-10">
          {!addingCustom ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAddingCustom(true)}
            >
              {t("market.emptyCustomLink")}
            </button>
          ) : (
            <div className="card p-3 text-left space-y-2">
              <label className="text-2xs font-semibold text-faint">{t("market.emptyCustomUrlLabel")}</label>
              <div className="flex items-center gap-2">
                <input
                  value={manifestUrl}
                  onChange={(event) => setManifestUrl(event.target.value)}
                  placeholder={t("market.manifestPlaceholder")}
                  spellCheck={false}
                  className="input flex-1 font-mono"
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm shrink-0"
                  disabled={!manifestUrl.trim()}
                  onClick={() => {
                    onUseCustom(manifestUrl.trim());
                    setAddingCustom(false);
                  }}
                >
                  {t("market.emptyCustomApply")}
                </button>
              </div>
              <p className="text-2xs text-faint leading-relaxed">{t("market.customHint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== 目录卡片 =====================

function MarketCard({
  item,
  skills,
  extensions,
  onInstallSkill,
  onOpenMcp,
}: {
  item: ReturnType<typeof marketplaceItems>[number];
  skills: Skill[];
  extensions: ExtensionRow[];
  onInstallSkill: (entry: MarketplaceSkill) => void;
  onOpenMcp: (entry: MarketplaceMcp) => void;
}) {
  const t = useT();

  if (item.kind === "skill") {
    const entry = item.entry;
    const local = findLocalSkill(skills, entry);
    return (
      <article className="card card-hover p-4 flex flex-col" data-testid={`market-skill-${entry.id}`}>
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <BookOpen size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-heading truncate">{entry.name}</h3>
              <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted shrink-0">
                {t("market.kindSkill")}
              </span>
              {local && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                  <Check size={10} className="inline mr-0.5" />
                  {t("market.badgeInstalled")}
                </span>
              )}
            </div>
            <p className="text-2xs text-faint mt-0.5 truncate">
              {t("market.author")}: {entry.author || "—"}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted leading-relaxed mt-3 line-clamp-3">{entry.description}</p>
        <div className="flex flex-wrap gap-1 mt-3">
          {entry.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted">{tag}</span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle">
          <span className="text-2xs text-faint font-mono truncate flex-1" title={entry.source.source_ref}>
            {local ? t("market.localSource", { lib: local.source_lib }) : entry.source.source_ref}
          </span>
          {local ? (
            <button
              type="button"
              className="btn btn-outline btn-sm shrink-0"
              onClick={() => {
                if (local.id) goToSkill(local.id);
                else toast().show(t("market.enableFailed"), "error");
              }}
              data-testid={`market-enable-${entry.id}`}
            >
              {t("market.enable")} <ArrowRight size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm shrink-0"
              onClick={() => onInstallSkill(entry)}
            >
              {t("market.install")}
            </button>
          )}
        </div>
      </article>
    );
  }

  const entry = item.entry;
  const needKey = entry.required_inputs.length > 0;
  const advanced = !entry.config;
  const installedSomewhere = extensions.some(
    (extension) => extension.kind === "mcp" && extension.name === entry.server_name,
  );
  return (
    <article className="card card-hover p-4 flex flex-col" data-testid={`market-mcp-${entry.id}`}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300 flex items-center justify-center shrink-0">
          <Plug size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-heading truncate">{entry.name}</h3>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300 shrink-0">
              {t("market.kindTool")}
            </span>
            {needKey && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 shrink-0">
                {t("market.badgeNeedKey")}
              </span>
            )}
            {advanced && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted shrink-0">
                {t("market.badgeAdvanced")}
              </span>
            )}
            {installedSomewhere && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                <Check size={10} className="inline mr-0.5" />
                {t("market.badgeInstalled")}
              </span>
            )}
          </div>
          {entry.version && (
            <p className="text-2xs text-faint mt-0.5">
              {t("market.version")} {entry.version}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted leading-relaxed mt-3 line-clamp-3">{entry.description}</p>
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle">
        <span className="text-2xs text-faint font-mono truncate flex-1" title={entry.server_name}>
          {entry.server_name}
        </span>
        {advanced ? (
          <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={() => onOpenMcp(entry)}>
            {t("market.detail")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => onOpenMcp(entry)}>
            {t("market.install")}
          </button>
        )}
      </div>
    </article>
  );
}

// ===================== 技能安装弹窗 =====================

function SkillInstallDialog({
  entry,
  libraries,
  skills,
  onClose,
  onInstalled,
}: {
  entry: MarketplaceSkill | null;
  libraries: LibrarySource[];
  skills: Skill[];
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const t = useT();
  const [libraryId, setLibraryId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  useEffect(() => {
    if (!entry) {
      setResult(null);
      setRiskConfirmed(false);
      return;
    }
    setResult(null);
    setRiskConfirmed(false);
    if (libraries.length > 0) {
      setLibraryId((current) => (current && libraries.some((library) => library.id === current) ? current : libraries[0].id));
    }
  }, [entry, libraries]);

  if (!entry) return null;

  const runInstall = async (overrideAudit: boolean) => {
    if (installing || !libraryId) return;
    setInstalling(true);
    try {
      const installResult = await installSkill(
        {
          kind: "git",
          source_ref: entry.source.source_ref,
          subdir: entry.source.subdir ?? null,
        },
        libraryId,
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
            <h3 className="connection-dialog-title">{t("market.dlgInstallTitle", { name: entry.name })}</h3>
            <p className="connection-dialog-message truncate" title={entry.source.source_ref}>
              {t("market.dlgFrom", { source: entry.source.source_ref, author: entry.author || "—" })}
            </p>
          </div>
        </div>

        {!result && (
          <>
            <StepLabel>
              {installing ? t("market.dlgStep1Checking") : t("market.dlgStep1")}
            </StepLabel>
            <CheckPanel tone="pending" icon={<ShieldCheck size={16} className={installing ? "animate-pulse" : ""} />}>
              <CheckPanelTitle tone="pending">{t("market.dlgCheckPendingTitle")}</CheckPanelTitle>
              <p className="text-2xs text-muted leading-relaxed mt-0.5">{t("market.dlgCheckPendingDesc")}</p>
            </CheckPanel>
            <StepLabel>{t("market.dlgStep2")}</StepLabel>
            <label className="block space-y-1 mb-1">
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.dlgLocation")}</span>
              <select value={libraryId} onChange={(event) => setLibraryId(event.target.value)} className="input">
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>{library.name}</option>
                ))}
              </select>
              <span className="block text-2xs text-faint leading-relaxed mt-1">{t("market.dlgLocationTip")}</span>
            </label>
            <div className="connection-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => runInstall(false)}
                disabled={installing || !libraryId}
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
              // 冲突结果不带 skill_id，按名称找本机已有技能
              goToSkill(result.skill_id ?? findLocalSkill(skills, entry)?.id);
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

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs font-semibold text-faint uppercase tracking-wider mb-1.5">{children}</div>
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

function CheckPanel({
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

function CheckPanelTitle({ tone, children }: { tone: PanelTone; children: React.ReactNode }) {
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

// ===================== 工具（MCP）安装向导 =====================

function McpInstallDialog({
  entry,
  agents,
  extensions,
  onClose,
  onDone,
}: {
  entry: MarketplaceMcp | null;
  agents: AgentInfo[];
  extensions: ExtensionRow[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [agentId, setAgentId] = useState("");
  const [configText, setConfigText] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [installing, setInstalling] = useState(false);

  const supportedAgents = agents.filter((agent) => agent.id !== "trae");

  useEffect(() => {
    if (!entry) return;
    const nextAgent = supportedAgents[0]?.id ?? "";
    setAgentId(nextAgent);
    setConfigText(entry.config ? JSON.stringify(entry.config, null, 2) : "");
    setValues({});
    setOverwriteConfirmed(false);
    setShowAdvanced(false);
  }, [entry, supportedAgents]);

  if (!entry) return null;
  const existing = extensions.find(
    (extension) => extension.kind === "mcp" && extension.runtime === agentId && extension.name === entry.server_name,
  );
  const selectedAgent = agents.find((agent) => agent.id === agentId);

  const save = async () => {
    if (installing || !entry.config) return;
    const parsed = parseMarketplaceMcpConfig(configText);
    if (!parsed.config) {
      toast().show(t("market.toolInvalidJson"), "error");
      return;
    }
    const applied = applyRequiredInputs(parsed.config, entry.required_inputs, values);
    if (!applied.config) {
      toast().show(t("market.toolMissingInputs"), "error");
      return;
    }
    if (existing && !overwriteConfirmed) return;

    setInstalling(true);
    try {
      await saveMcpCmd({
        runtime: agentId,
        name: entry.server_name,
        config_json: JSON.stringify(applied.config),
        old_name: existing?.name,
      });
      toast().show(t("market.toolWritten", { agent: selectedAgent?.label ?? agentId }));
      await onDone();
      onClose();
    } catch (error) {
      toast().show(t("market.toolWriteFailed", { msg: String(error) }), "error");
    } finally {
      setInstalling(false);
    }
  };

  // 进阶条目：无法自动生成配置，只展示说明与文档入口
  if (!entry.config) {
    return (
      <div className="connection-dialog-overlay" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <div role="dialog" aria-modal="true" className="install-dialog" data-testid="market-install-mcp-dialog">
          <div className="flex items-start gap-2.5 mb-3.5 pr-7">
            <div className="connection-dialog-icon bg-sky-500/10 text-sky-600">
              <Plug size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="connection-dialog-title">{t("market.toolTitle", { name: entry.name })}</h3>
              <p className="connection-dialog-message">{entry.description}</p>
            </div>
          </div>
          <CheckPanel tone="warn" icon={<TriangleAlert size={16} />}>
            <CheckPanelTitle tone="warn">{t("market.toolManualTitle")}</CheckPanelTitle>
            <p className="text-2xs text-muted leading-relaxed mt-0.5">{t("market.toolManualDesc")}</p>
          </CheckPanel>
          <div className="connection-dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
              {t("common.close")}
            </button>
            {entry.homepage && (
              <a
                href={entry.homepage}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline btn-sm"
              >
                <ExternalLink size={12} /> {t("market.toolManualDocs")}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="connection-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !installing) onClose();
    }}>
      <div role="dialog" aria-modal="true" className="install-dialog" data-testid="market-install-mcp-dialog">
        <div className="flex items-start gap-2.5 mb-3.5 pr-7">
          <div className="connection-dialog-icon bg-sky-500/10 text-sky-600">
            <Plug size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="connection-dialog-title">{t("market.toolTitle", { name: entry.name })}</h3>
            <p className="connection-dialog-message">{entry.description}</p>
          </div>
        </div>

        <StepLabel>{t("market.toolStep1")}</StepLabel>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {agents.map((agent) => {
            const supported = agent.id !== "trae";
            const active = agentId === agent.id;
            const count = extensions.filter(
              (extension) => extension.kind === "mcp" && extension.runtime === agent.id,
            ).length;
            return (
              <button
                key={agent.id}
                type="button"
                disabled={!supported}
                onClick={() => {
                  setAgentId(agent.id);
                  setOverwriteConfirmed(false);
                }}
                className={
                  "rounded-lg border p-2.5 text-center transition-colors " +
                  (active
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:border-border-strong") +
                  (supported ? "" : " opacity-50 cursor-not-allowed")
                }
              >
                <div className="text-xs font-semibold text-heading">{agent.label}</div>
                <div className="text-2xs text-faint mt-0.5">
                  {supported ? t("market.toolInstalledCount", { count }) : t("market.toolUnsupported")}
                </div>
              </button>
            );
          })}
        </div>

        {entry.required_inputs.length > 0 && (
          <>
            <StepLabel>{t("market.toolStep2")}</StepLabel>
            <div className="space-y-2.5">
              {entry.required_inputs.map((input) => (
                <label key={input.name} className="block space-y-1">
                  <span className="text-2xs font-medium text-muted">{input.description || input.name}</span>
                  <input
                    type={input.is_secret ? "password" : "text"}
                    value={values[input.name] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
                    placeholder={input.placeholder || t("market.toolInputPlaceholder", { name: input.name })}
                    autoComplete="off"
                    className="input"
                  />
                </label>
              ))}
              <p className="text-2xs text-faint leading-relaxed">
                {t("market.toolTokenTip")}
                {entry.homepage && (
                  <>
                    {" "}
                    <a href={entry.homepage} target="_blank" rel="noreferrer" className="text-accent">
                      {t("market.toolTokenHelp")}
                    </a>
                  </>
                )}
                {"　" + t("market.toolTokenLocal")}
              </p>
            </div>
          </>
        )}

        <button
          type="button"
          className="flex items-center gap-1.5 w-full mt-3 px-2.5 py-2 rounded-lg border border-dashed border-border-strong text-2xs text-faint hover:text-muted"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {t("market.toolAdvanced")}
        </button>
        {showAdvanced && (
          <textarea
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            rows={8}
            spellCheck={false}
            className="input font-mono resize-y mt-2"
          />
        )}

        {existing && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mt-3 dark:border-amber-900 dark:bg-amber-900/30 cursor-pointer">
            <input
              type="checkbox"
              checked={overwriteConfirmed}
              onChange={(event) => setOverwriteConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span className="text-2xs text-amber-800 dark:text-amber-200 leading-relaxed">
              {t("market.toolOverwrite", { agent: selectedAgent?.label ?? agentId, name: entry.name })}
            </span>
          </label>
        )}

        <div className="connection-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={installing || !agentId || (!!existing && !overwriteConfirmed)}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
            {installing
              ? t("market.toolInstalling")
              : t("market.toolInstallTo", { agent: selectedAgent?.label ?? agentId })}
          </button>
        </div>
      </div>
    </div>
  );
}
