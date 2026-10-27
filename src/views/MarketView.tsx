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
  Plus,
  RefreshCw,
  Search,
  Store,
  TriangleAlert,
} from "lucide-react";
import type {
  AgentInfo,
  ExtensionRow,
  LibrarySource,
  MarketplaceMcp,
  MarketplaceSkill,
  Skill,
} from "../types";
import { saveMcpCmd } from "../lib/tauri";
import {
  applyRequiredInputs,
  filterMarketplaceItems,
  marketplaceItems,
  mergeCatalogs,
  parseMarketplaceMcpConfig,
  type MarketplaceKind,
} from "../lib/marketplace";
import { useSkillsStore } from "../stores/skills";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import { useExtensionsStore } from "../stores/extensions";
import { useActivityStore } from "../stores/activity";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useMarketplaceStore } from "../stores/marketplace";
import PageHeader from "../components/PageHeader";
import SkillInstallDialog, { CheckPanel, CheckPanelTitle, StepLabel } from "../components/skills/SkillInstallDialog";

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

/** 搜索防抖：输入即时回显，列表延迟过滤 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
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

  const officialMcpCatalog = useMarketplaceStore((state) => state.officialMcpCatalog);
  const officialSkillCatalog = useMarketplaceStore((state) => state.officialSkillCatalog);
  const customCatalog = useMarketplaceStore((state) => state.customCatalog);
  const officialMcpSyncing = useMarketplaceStore((state) => state.officialMcpSyncing);
  const officialSkillSyncing = useMarketplaceStore((state) => state.officialSkillSyncing);
  const customSyncing = useMarketplaceStore((state) => state.customSyncing);
  const officialMcpError = useMarketplaceStore((state) => state.officialMcpError);
  const officialSkillError = useMarketplaceStore((state) => state.officialSkillError);
  const customError = useMarketplaceStore((state) => state.customError);
  const manifestUrl = useMarketplaceStore((state) => state.manifestUrl);
  const autoSynced = useMarketplaceStore((state) => state.autoSynced);
  const syncOfficialMcps = useMarketplaceStore((state) => state.syncOfficialMcps);
  const syncOfficialSkills = useMarketplaceStore((state) => state.syncOfficialSkills);
  const syncCustom = useMarketplaceStore((state) => state.syncCustom);
  const setManifestUrl = useMarketplaceStore((state) => state.setManifestUrl);
  const markAutoSynced = useMarketplaceStore((state) => state.markAutoSynced);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MarketplaceKind>("skill");
  const [skillEntry, setSkillEntry] = useState<MarketplaceSkill | null>(null);
  const [customInstall, setCustomInstall] = useState(false);
  const [mcpEntry, setMcpEntry] = useState<MarketplaceMcp | null>(null);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);

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

  // 进店自动同步两个官方目录；失败时留内联错误 + 重试，不弹 toast 打扰
  useEffect(() => {
    if (!autoSynced) {
      markAutoSynced();
      syncOfficialSkills();
      syncOfficialMcps();
    }
  }, [autoSynced, markAutoSynced, syncOfficialSkills, syncOfficialMcps]);

  // 官方技能目录 + 官方工具目录各自与团队目录合并；Tab 直接决定展示哪类条目
  const skillCatalog = useMemo(
    () => mergeCatalogs(officialSkillCatalog, customCatalog),
    [officialSkillCatalog, customCatalog],
  );
  const mcpCatalog = useMemo(
    () => mergeCatalogs(officialMcpCatalog, customCatalog),
    [officialMcpCatalog, customCatalog],
  );
  const allItems = useMemo(
    () => [...marketplaceItems(skillCatalog), ...marketplaceItems(mcpCatalog)],
    [skillCatalog, mcpCatalog],
  );
  const activeItems = useMemo(
    () => allItems.filter((item) => item.kind === tab),
    [allItems, tab],
  );
  const filtered = useMemo(
    () => filterMarketplaceItems(activeItems, { query: debouncedQuery, kind: "all", tag: null }),
    [activeItems, debouncedQuery],
  );

  const openMcp = (entry: MarketplaceMcp) => {
    setMcpEntry(entry);
  };

  const activeCatalog = tab === "skill" ? skillCatalog : mcpCatalog;
  const catalogTime = useMemo(() => {
    if (!activeCatalog) return "";
    const date = new Date(activeCatalog.synced_at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [activeCatalog]);

  const loading = tab === "skill"
    ? officialSkillSyncing && !skillCatalog
    : officialMcpSyncing && !mcpCatalog;
  // 错误条只显示当前 Tab 对应的错误
  const activeError = tab === "skill" ? officialSkillError : officialMcpError;
  const activeSyncing = tab === "skill" ? officialSkillSyncing : officialMcpSyncing;
  const retryActive = tab === "skill" ? syncOfficialSkills : syncOfficialMcps;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="market-view">
      <PageHeader
        title={t("market.title")}
        subtitle={t("market.desc")}
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setCustomInstall(true)}
              title={t("market.customDesc")}
            >
              <Download size={13} /> {t("market.customInstall")}
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setSourceDialogOpen(true)}
              title={t("market.sourceDialogTitle")}
            >
              <Plus size={13} /> {t("market.addSource")}
            </button>
            {activeCatalog && (
              <button type="button" className="btn btn-outline btn-sm" onClick={retryActive} disabled={activeSyncing}>
                {activeSyncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {activeSyncing ? t("market.syncing") : t("market.refresh")}
              </button>
            )}
          </>
        }
      />

      {activeCatalog && !loading && (
        <div className="border-b border-border-subtle bg-surface px-6 py-3 flex flex-wrap items-center gap-2">
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
            {(["skill", "mcp"] as MarketplaceKind[]).map((itemKind) => (
              <button
                key={itemKind}
                type="button"
                onClick={() => setTab(itemKind)}
                className={"btn btn-sm border-0 " + (tab === itemKind ? "btn-primary" : "btn-ghost")}
              >
                {itemKind === "skill"
                  ? t("market.skills", { count: skillCatalog?.skills.length ?? 0 })
                  : t("market.mcps", { count: mcpCatalog?.mcps.length ?? 0 })}
              </button>
            ))}
          </div>
          {customCatalog && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-soft text-accent shrink-0">
              {t("market.customBadge", { name: customCatalog.name })}
            </span>
          )}
          {catalogTime && (
            <span className="text-2xs text-faint shrink-0">{t("market.updatedAt", { time: catalogTime })}</span>
          )}
        </div>
      )}

      {(activeError || customError) && !loading && (
        <div className="px-6 py-2.5 border-b border-border-subtle bg-red-50/60 dark:bg-red-900/20 flex items-center gap-2">
          <TriangleAlert size={13} className="text-red-500 shrink-0" />
          <span className="text-2xs text-red-600 dark:text-red-300 truncate flex-1">
            {activeError
              ? t("market.syncFailedShort", { msg: activeError })
              : t("market.syncFailedShort", { msg: customError ?? "" })}
          </span>
          {activeError && (
            <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={retryActive} disabled={activeSyncing}>
              {activeSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t("market.retry")}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <MarketSkeleton />
        ) : !activeCatalog ? (
          <EmptyMarket onAddSource={() => setSourceDialogOpen(true)} />
        ) : filtered.length === 0 ? (
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

      <SourceDialog
        open={sourceDialogOpen}
        manifestUrl={manifestUrl}
        customSyncing={customSyncing}
        customCatalog={customCatalog}
        onClose={() => setSourceDialogOpen(false)}
        onChangeUrl={setManifestUrl}
        onSync={async () => {
          await syncCustom();
        }}
        onRemove={() => {
          setManifestUrl("");
          setSourceDialogOpen(false);
        }}
      />

      <SkillInstallDialog
        target={
          skillEntry
            ? { mode: "entry", entry: skillEntry }
            : customInstall
              ? { mode: "custom" }
              : null
        }
        libraries={librarySources.filter((library) => library.enabled)}
        skills={skills}
        onClose={() => {
          setSkillEntry(null);
          setCustomInstall(false);
        }}
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

// ===================== 骨架屏 =====================

function MarketSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="market-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="card p-4 animate-pulse" aria-hidden="true">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-2 shrink-0" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-3 rounded bg-surface-2 w-1/3" />
              <div className="h-2.5 rounded bg-surface-2 w-1/5" />
            </div>
          </div>
          <div className="space-y-1.5 mt-4">
            <div className="h-2.5 rounded bg-surface-2" />
            <div className="h-2.5 rounded bg-surface-2 w-5/6" />
            <div className="h-2.5 rounded bg-surface-2 w-2/3" />
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-subtle">
            <div className="h-2.5 rounded bg-surface-2 w-1/3" />
            <div className="h-6 w-14 rounded-lg bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ===================== 目录来源对话框 =====================

function SourceDialog({
  open,
  manifestUrl,
  customSyncing,
  customCatalog,
  onClose,
  onChangeUrl,
  onSync,
  onRemove,
}: {
  open: boolean;
  manifestUrl: string;
  customSyncing: boolean;
  customCatalog: MarketplaceCatalogLike | null;
  onClose: () => void;
  onChangeUrl: (url: string) => void;
  onSync: () => Promise<void>;
  onRemove: () => void;
}) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="connection-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !customSyncing) onClose();
    }}>
      <div role="dialog" aria-modal="true" className="install-dialog" data-testid="market-source-dialog">
        <div className="flex items-start gap-2.5 mb-3.5 pr-7">
          <div className="connection-dialog-icon bg-accent-soft text-accent">
            <Store size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="connection-dialog-title">{t("market.sourceDialogTitle")}</h3>
            <p className="connection-dialog-message">{t("market.sourceDialogDesc")}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 mb-3">
          <div className="flex items-center gap-2">
            <Plug size={13} className="text-accent shrink-0" />
            <span className="text-xs font-semibold text-heading flex-1">{t("market.sourceOfficialTitle")}</span>
            <span className="text-2xs text-faint">{t("market.sourceAlwaysOn")}</span>
          </div>
          <p className="text-2xs text-muted mt-1 leading-relaxed">{t("market.sourceOfficialDesc")}</p>
        </div>

        <div className="rounded-lg border border-border-subtle p-3 space-y-2">
          <div className="flex items-center gap-2">
            <BookOpen size={13} className="text-accent shrink-0" />
            <span className="text-xs font-semibold text-heading flex-1">{t("market.sourceCustomTitle")}</span>
            {customCatalog && (
              <span className="text-2xs text-emerald-600 dark:text-emerald-300">
                <Check size={10} className="inline mr-0.5" />
                {t("market.sourceConnected", { name: customCatalog.name })}
              </span>
            )}
          </div>
          <p className="text-2xs text-muted leading-relaxed">{t("market.customHint")}</p>
          <input
            value={manifestUrl}
            onChange={(event) => onChangeUrl(event.target.value)}
            placeholder={t("market.manifestPlaceholder")}
            spellCheck={false}
            className="input font-mono"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!manifestUrl.trim() || customSyncing}
              onClick={onSync}
            >
              {customSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {customSyncing ? t("market.syncing") : t("market.sourceConnect")}
            </button>
            {customCatalog && (
              <button type="button" className="btn btn-ghost btn-sm text-red-500 hover:text-red-600" onClick={onRemove}>
                {t("market.sourceRemove")}
              </button>
            )}
          </div>
        </div>

        <div className="connection-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

type MarketplaceCatalogLike = { name: string };

// ===================== 空态引导 =====================

function EmptyMarket({ onAddSource }: { onAddSource: () => void }) {
  const t = useT();
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
        <Store size={22} />
      </div>
      <h2 className="text-sm font-bold text-heading mt-3">{t("market.emptyTitle")}</h2>
      <p className="text-xs text-muted mt-1 max-w-[380px] leading-relaxed">{t("market.emptyDesc")}</p>
      <button type="button" className="btn btn-outline btn-sm mt-4" onClick={onAddSource}>
        <Plus size={13} /> {t("market.emptyAddSource")}
      </button>
      <p className="text-2xs text-faint mt-4 max-w-[360px] leading-relaxed">{t("market.emptyPrivacy")}</p>
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
                  {/* 密钥输入用 CSS 掩码（-webkit-text-security，WKWebView/Chromium 均支持），不再使用 type="password" */}
                  <input
                    type="text"
                    value={values[input.name] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
                    placeholder={input.placeholder || t("market.toolInputPlaceholder", { name: input.name })}
                    autoComplete="off"
                    className={"input" + (input.is_secret ? " [-webkit-text-security:disc]" : "")}
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
