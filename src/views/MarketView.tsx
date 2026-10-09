import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import type {
  AgentInfo,
  ExtensionRow,
  InstallResult,
  LibrarySource,
  MarketplaceMcp,
  MarketplaceSkill,
} from "../types";
import { installSkill, saveMcpCmd } from "../lib/tauri";
import {
  DEFAULT_MCP_REGISTRY_URL,
  applyRequiredInputs,
  filterMarketplaceItems,
  hasInstalledMarketplaceSkill,
  marketplaceItems,
  parseMarketplaceMcpConfig,
  type MarketplaceKind,
} from "../lib/marketplace";
import { INSTALL_STATUS_META, needsUserConfirm } from "../lib/skillAudit";
import AuditFindings from "../components/AuditFindings";
import { useSkillsStore } from "../stores/skills";
import { useWorkspaceStore } from "../stores/workspace";
import { useExtensionsStore } from "../stores/extensions";
import { useActivityStore } from "../stores/activity";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useMarketplaceStore } from "../stores/marketplace";

const toast = () => useToastStore.getState();

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
  const [tag, setTag] = useState<string | null>(null);
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

  useEffect(() => {
    setTag(null);
  }, [catalog?.source_url, catalog?.synced_at]);

  const enabledLibraries = useMemo(
    () => librarySources.filter((library) => library.enabled),
    [librarySources],
  );
  const mcpAgents = useMemo(
    () => agentOptions.filter((agent) => agent.id !== "trae"),
    [agentOptions],
  );
  const items = useMemo(() => marketplaceItems(catalog), [catalog]);
  const filtered = useMemo(
    () => filterMarketplaceItems(items, { query, kind, tag }),
    [items, query, kind, tag],
  );
  const tags = useMemo(() => {
    const unique = new Map<string, number>();
    for (const item of items) {
      for (const itemTag of item.entry.tags) {
        unique.set(itemTag, (unique.get(itemTag) ?? 0) + 1);
      }
    }
    return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const effectiveUrl = sourceMode === "registry"
    ? DEFAULT_MCP_REGISTRY_URL
    : manifestUrl.trim();

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="market-view">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
        <h2 className="text-sm font-semibold text-content dark:text-heading">{t("market.title")}</h2>
        <span className="text-[13px] text-faint hidden lg:inline">{t("market.desc")}</span>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setSourceMode("registry");
                setTag(null);
              }}
              className={"btn btn-sm border-0 " + (sourceMode === "registry" ? "btn-primary" : "btn-ghost")}
            >
              {t("market.registrySource")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("custom");
                setTag(null);
              }}
              className={"btn btn-sm border-0 " + (sourceMode === "custom" ? "btn-primary" : "btn-ghost")}
            >
              {t("market.customSource")}
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={syncMarket} disabled={syncing || !effectiveUrl}>
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {syncing ? t("market.syncing") : t("market.sync")}
          </button>
        </div>
      </div>

      <div className="border-b border-border-subtle bg-surface px-6 py-3 space-y-3">
        {sourceMode === "custom" ? (
          <div className="flex items-center gap-2">
            <input
              value={manifestUrl}
              onChange={(event) => setManifestUrl(event.target.value)}
              placeholder={t("market.manifestPlaceholder")}
              spellCheck={false}
              className="input flex-1 font-mono"
              aria-label={t("market.sourceLabel")}
            />
          </div>
        ) : (
          <div className="text-2xs text-muted font-mono truncate">{DEFAULT_MCP_REGISTRY_URL}</div>
        )}
        <div className="text-2xs text-faint">
          {sourceMode === "custom" ? t("market.customManifestHint") : t("market.syncNotice")}
        </div>
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
          <select value={tag ?? ""} onChange={(event) => setTag(event.target.value || null)} className="input w-40">
            <option value="">{t("common.allTags")}</option>
            {tags.map(([itemTag, count]) => (
              <option key={itemTag} value={itemTag}>{itemTag} ({count})</option>
            ))}
          </select>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(["all", "skill", "mcp"] as MarketplaceKind[]).map((itemKind) => (
              <button
                key={itemKind}
                type="button"
                onClick={() => setKind(itemKind)}
                className={"btn btn-sm border-0 " + (kind === itemKind ? "btn-primary" : "btn-ghost")}
              >
                {itemKind === "all" ? t("market.all") : itemKind === "skill" ? t("market.skills") : t("market.mcps")}
              </button>
            ))}
          </div>
          <span className="text-2xs text-faint">{t("market.count", { count: filtered.length })}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-4">
        {!catalog ? (
          <EmptyMarket icon={<Store size={40} />} text={t("market.empty")} hint={t("market.emptyHint")} />
        ) : filtered.length === 0 ? (
          <EmptyMarket icon={<Search size={40} />} text={t("market.noMatch")} hint={catalog.name} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((item) => (
              <article key={`${item.kind}:${item.entry.id}`} className="card card-hover p-4 flex flex-col">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                    {item.kind === "skill" ? <BookOpen size={17} /> : <Server size={17} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-heading truncate">{item.entry.name}</h3>
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted shrink-0">
                        {item.kind === "skill" ? t("market.skills") : t("market.mcps")}
                      </span>
                    </div>
                    <p className="text-2xs text-faint mt-0.5">
                      {t("market.author")}: {item.entry.author || "—"}
                      {item.kind === "mcp" && item.entry.version ? ` · ${t("market.version")} ${item.entry.version}` : ""}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed mt-3 line-clamp-3">{item.entry.description}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {item.kind === "mcp" && !item.entry.config && (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {t("market.manualConfig")}
                    </span>
                  )}
                  {item.entry.tags.slice(0, 5).map((itemTag) => (
                    <span key={itemTag} className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted">
                      {itemTag}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle">
                  {item.entry.homepage && (
                    <a
                      href={item.entry.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost btn-sm"
                    >
                      <ExternalLink size={12} /> {t("market.openSource")}
                    </a>
                  )}
                  <div className="ml-auto">
                    {item.kind === "skill" ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setSkillEntry(item.entry)}
                        disabled={hasInstalledMarketplaceSkill(skills, item.entry)}
                      >
                        {hasInstalledMarketplaceSkill(skills, item.entry) ? t("market.installed") : t("market.installSkill")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setMcpEntry(item.entry)}
                        disabled={!item.entry.config}
                      >
                        {t("market.installMcp")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <SkillInstallDialog
        entry={skillEntry}
        libraries={enabledLibraries}
        onClose={() => setSkillEntry(null)}
        onInstalled={async () => {
          await loadSkills();
          await loadActivity();
          setSkillEntry(null);
        }}
      />
      <McpInstallDialog
        entry={mcpEntry}
        agents={mcpAgents}
        extensions={extensions}
        onClose={() => setMcpEntry(null)}
        onDone={async () => {
          await loadExtensions();
          await loadActivity();
          setMcpEntry(null);
        }}
      />
    </div>
  );
}

function EmptyMarket({ icon, text, hint }: { icon: React.ReactNode; text: string; hint: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-faint">
      <span className="opacity-30">{icon}</span>
      <p className="text-sm mt-2">{text}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  );
}

function SkillInstallDialog({
  entry,
  libraries,
  onClose,
  onInstalled,
}: {
  entry: MarketplaceSkill | null;
  libraries: LibrarySource[];
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const t = useT();
  const [libraryId, setLibraryId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);

  useEffect(() => {
    if (!entry) {
      setResult(null);
      return;
    }
    setResult(null);
    if (libraries.length > 0) {
      setLibraryId((current) => (current && libraries.some((library) => library.id === current) ? current : libraries[0].id));
    }
  }, [entry, libraries]);

  if (!entry) return null;

  const runInstall = async (overrideAudit: boolean) => {
    if (installing || !libraryId) return;
    setInstalling(true);
    setResult(null);
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
        toast().show(`${t("market.installed")}: ${installResult.skill_name}`);
        await onInstalled();
      }
    } catch (error) {
      toast().show(String(error), "error");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="connection-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !installing) onClose();
    }}>
      <div role="dialog" aria-modal="true" className="install-dialog">
        <div className="flex items-center gap-2">
          <div className="connection-dialog-icon bg-indigo-500/10 text-indigo-600">
            <BookOpen size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="connection-dialog-title">{entry.name}</h3>
            <p className="connection-dialog-message">{t("market.skillSecurityNotice")}</p>
          </div>
        </div>

        <div className="space-y-3">
          <DetailRow label={t("market.gitSource")} value={entry.source.source_ref} />
          {entry.source.subdir && <DetailRow label={t("market.subdir")} value={entry.source.subdir} />}
          <label className="block space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.targetLibrary")}</span>
            <select value={libraryId} onChange={(event) => setLibraryId(event.target.value)} className="input">
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>{library.name}</option>
              ))}
            </select>
          </label>
        </div>

        {result && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-heading">
                  {INSTALL_STATUS_META[result.status]?.label ?? result.status}
                </div>
                <div className="text-2xs text-muted">{result.message}</div>
              </div>
            </div>
            {result.report && result.report.findings.length > 0 && <AuditFindings findings={result.report.findings} />}
            {needsUserConfirm(result.status) && (
              <button type="button" className="btn btn-danger btn-sm w-full" onClick={() => runInstall(true)} disabled={installing}>
                {installing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                {t("market.install")}
              </button>
            )}
          </div>
        )}

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
            {installing ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
            {t("market.installSkill")}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const nextAgent = agents[0]?.id ?? "claude";
    setAgentId(nextAgent);
    setConfigText(entry.config ? JSON.stringify(entry.config, null, 2) : "");
    setValues({});
    setOverwriteConfirmed(false);
  }, [entry, agents]);

  if (!entry) return null;
  const existing = extensions.find(
    (extension) => extension.kind === "mcp" && extension.runtime === agentId && extension.name === entry.server_name,
  );

  const save = async () => {
    if (installing || !entry.config) return;
    const parsed = parseMarketplaceMcpConfig(configText);
    if (!parsed.config) {
      toast().show(t("market.invalidMcpJson"), "error");
      return;
    }
    const applied = applyRequiredInputs(parsed.config, entry.required_inputs, values);
    if (!applied.config) {
      toast().show(t("market.missingInputs"), "error");
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
      toast().show(t("market.mcpWritten", { name: entry.server_name, agent: agentId }));
      await onDone();
    } catch (error) {
      toast().show(t("market.mcpWriteFailed", { msg: String(error) }), "error");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="connection-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !installing) onClose();
    }}>
      <div role="dialog" aria-modal="true" className="install-dialog">
        <div className="flex items-center gap-2">
          <div className="connection-dialog-icon bg-sky-500/10 text-sky-600">
            <Server size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="connection-dialog-title">{entry.name}</h3>
            <p className="connection-dialog-message">{entry.description}</p>
          </div>
        </div>

        <div className="space-y-3">
          <DetailRow label={t("market.serverName")} value={entry.server_name} />
          <label className="block space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.targetAgent")}</span>
            <select value={agentId} onChange={(event) => {
              setAgentId(event.target.value);
              setOverwriteConfirmed(false);
            }} className="input">
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.label}</option>
              ))}
            </select>
          </label>

          {entry.required_inputs.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
              <div className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.requiredInputs")}</div>
              {entry.required_inputs.map((input) => (
                <label key={input.name} className="block space-y-1">
                  <span className="text-2xs text-muted">
                    {input.name}
                    {input.is_secret ? ` · ${t("market.secretInput")}` : ""}
                  </span>
                  <input
                    type={input.is_secret ? "password" : "text"}
                    value={values[input.name] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
                    placeholder={input.placeholder || t("market.inputPlaceholder", { name: input.name })}
                    autoComplete="off"
                    className="input"
                  />
                </label>
              ))}
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("market.configJson")}</span>
            <textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              rows={10}
              spellCheck={false}
              className="input font-mono resize-y"
            />
          </label>

          {existing && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-900/30">
              <input
                type="checkbox"
                checked={overwriteConfirmed}
                onChange={(event) => setOverwriteConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span className="text-2xs text-amber-800 dark:text-amber-200">{t("market.existingMcp")}</span>
            </label>
          )}
        </div>

        <div className="connection-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={installing || !agentId || !configText.trim() || (!!existing && !overwriteConfirmed)}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
            {existing ? t("market.overwriteMcp") : t("market.installMcp")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs font-semibold text-faint uppercase tracking-wider">{label}</div>
      <div className="text-xs text-muted font-mono break-all">{value}</div>
    </div>
  );
}
