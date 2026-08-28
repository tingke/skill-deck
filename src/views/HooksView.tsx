import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../stores/app";
import {
  deleteExt,
  extConfigPath,
  getHookObserverStatus,
  scanExt,
  saveHookCmd,
  setHookObserverEnabled,
  toggleExt,
} from "../lib/tauri";
import { Webhook, Plus, X } from "lucide-react";
import type { ExtensionRow, HookInput, HookObserverStatus } from "../types";
import { HOOK_EVENTS } from "../types";
import { ExtRow, ToggleSwitch } from "../components/ExtList";
import { AgentGlyph } from "../components/AgentGlyph";
import { EmptyState } from "./MCPView";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";

const toast = () => useToastStore.getState();

export default function HooksView() {
  const t = useT();
  const { loadExtensions } = useAppStore();
  const allExtensions = useAppStore((s) => s.extensions);
  const extensions = useMemo(
    () =>
      allExtensions.filter(
        (extension) =>
          extension.kind === "hook" &&
          !extension.config_json.includes("skilldeck-agent-observer"),
      ),
    [allExtensions],
  );
  const extIds = extensions.map((e) => e.id).join(",");
  const [editing, setEditing] = useState<ExtensionRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [observerStatuses, setObserverStatuses] = useState<HookObserverStatus[]>([]);
  const [observerBusy, setObserverBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ids = extIds.split(",").filter(Boolean);
      const p: Record<string, string> = {};
      for (const id of ids) {
        try { p[id] = await extConfigPath(id); } catch { /* ignore */ }
      }
      setPaths(p);
    })();
  }, [extIds]);

  useEffect(() => {
    (async () => {
      try { setObserverStatuses(await getHookObserverStatus()); } catch { /* ignore */ }
    })();
  }, []);

  const handleObserverToggle = async (status: HookObserverStatus) => {
    if (observerBusy) return;
    setObserverBusy(status.agent);
    try {
      const next = await setHookObserverEnabled(status.agent, !status.installed);
      setObserverStatuses((current) =>
        current.map((item) => (item.agent === status.agent ? next : item)),
      );
      const extensions = await scanExt();
      useAppStore.setState({ extensions });
      toast().show(next.installed ? t("hooks.observerEnabled", { agent: status.agent }) : t("hooks.observerDisabled", { agent: status.agent }), "info");
    } catch (error) {
      toast().show(t("hooks.observerToggleFailed", { msg: String(error) }), "error");
    } finally {
      setObserverBusy(null);
    }
  };

  const handleToggle = async (ext: ExtensionRow) => {
    const next = !ext.enabled;
    useAppStore.setState((s) => ({
      extensions: s.extensions.map((e) => (e.id === ext.id ? { ...e, enabled: next } : e)),
    }));
    try {
      await toggleExt(ext.id, next);
      toast().show(next ? t("ext.enabled") : t("ext.disabled"), "info");
    } catch (e) {
      useAppStore.setState((s) => ({
        extensions: s.extensions.map((e) => (e.id === ext.id ? { ...e, enabled: !next } : e)),
      }));
      toast().show(t("common.operationFailed") + ": " + e, "error");
    }
  };

  const handleDelete = async (ext: ExtensionRow) => {
    try {
      await deleteExt(ext.id);
      await loadExtensions();
      toast().show(t("ext.deleted"), "info");
    } catch (e) {
      toast().show(t("common.deleteFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
        <h2 className="text-sm font-semibold text-content dark:text-heading">{t("hooks.title")}</h2>
        <span className="text-[11px] text-faint">{t("hooks.desc")}</span>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setShowAdd(true)} className="btn btn-primary">
            <Plus size={14} /> {t("hooks.add")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-4">
        <section className="bg-surface rounded-xl border border-border p-4 mb-4" data-testid="agent-observer-panel">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-content">{t("hooks.observerTitle")}</h3>
            <span className="badge bg-surface-2 text-muted">{t("hooks.observerBadge")}</span>
          </div>
          <p className="text-xs text-faint mb-3 max-w-2xl">{t("hooks.observerDesc")}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {observerStatuses.map((status) => (
              <div key={status.agent} className="flex items-center gap-3 bg-surface-2 rounded-lg px-3 py-2.5 min-w-0">
                <AgentGlyph id={status.agent} label={status.agent} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-content">{status.agent}</div>
                  <div className="text-2xs text-faint truncate" title={status.configPath}>
                    {status.installed ? t("hooks.observerInstalled") : t("hooks.observerNotInstalled")}
                  </div>
                </div>
                <ToggleSwitch
                  checked={status.installed}
                  onChange={() => void handleObserverToggle(status)}
                />
              </div>
            ))}
          </div>
        </section>

        {extensions.length === 0 ? (
          <EmptyState icon={<Webhook size={40} />} text={t("hooks.empty")} hint={t("hooks.emptyHint")} />
        ) : (
          <div className="space-y-1.5">
            {extensions.map((ext) => (
              <ExtRow key={ext.id} ext={ext} kindPath={paths[ext.id]} onToggle={() => handleToggle(ext)} onDelete={() => handleDelete(ext)} onEdit={() => setEditing(ext)} />
            ))}
          </div>
        )}
      </div>

      {(showAdd || editing) && (
        <HookModal existing={editing} t={t} onClose={() => { setShowAdd(false); setEditing(null); }} onDone={async () => { await loadExtensions(); setShowAdd(false); setEditing(null); }} />
      )}
    </div>
  );
}

function HookModal({ existing, t, onClose, onDone }: { existing: ExtensionRow | null; t: ReturnType<typeof useT>; onClose: () => void; onDone: () => void }) {
  const isEdit = !!existing;
  const initCfg = (() => { try { return JSON.parse(existing?.config_json || "{}"); } catch { return {}; } })();
  const [runtime, setRuntime] = useState(existing?.runtime || "claude");
  const [event, setEvent] = useState(existing?.name || "PreToolUse");
  const [matcher, setMatcher] = useState(initCfg.matcher || "*");
  const [command, setCommand] = useState(initCfg.command || "");
  const [timeout, setTimeoutVal] = useState(initCfg.timeout || 10);

  const handleSave = async () => {
    if (!command.trim()) {
      toast().show(t("hooks.cmdRequired"), "error");
      return;
    }
    const input: HookInput = { runtime, event, matcher: matcher.trim() || "*", command: command.trim(), timeout };
    try {
      // 编辑时先删除旧条目（DB 行 + settings.json 中按旧 command 匹配的条目），
      // 否则修改 command 会因 id 含 command 哈希而残留重复 hook
      if (existing) {
        await deleteExt(existing.id);
      }
      await saveHookCmd(input);
      toast().show(isEdit ? t("hooks.updated") : t("hooks.addedTo", { event }));
      onDone();
    } catch (e) {
      toast().show(t(isEdit ? "hooks.updateFailed" : "hooks.addFailed", { msg: String(e) }), "error");
      if (existing) await useAppStore.getState().loadExtensions();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold dark:text-heading">{isEdit ? t("hooks.editTitle") : t("hooks.addTitle")}</h3>
          <button onClick={onClose} className="btn-icon"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("hooks.runtimeLabel")}</label>
            <select value={runtime} onChange={(e) => setRuntime(e.target.value)} disabled={isEdit}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-transparent dark:text-content disabled:opacity-60">
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <div className="flex gap-2">
            <select value={event} onChange={(e) => setEvent(e.target.value)} disabled={isEdit}
              className="flex-1 px-2.5 py-1.5 text-sm border border-border rounded-lg bg-transparent dark:text-content disabled:opacity-60">
              {HOOK_EVENTS.map((ev) => (<option key={ev} value={ev}>{ev}</option>))}
            </select>
            <input value={matcher} onChange={(e) => setMatcher(e.target.value)} placeholder={t("hooks.matcherPlaceholder")}
              className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content font-mono" />
          </div>
          <textarea value={command} onChange={(e) => setCommand(e.target.value)} rows={4} placeholder={t("hooks.commandPlaceholder")}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content font-mono" />
          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("hooks.timeoutLabel")}</label>
            <input type="number" value={timeout} onChange={(e) => setTimeoutVal(Number(e.target.value) || 10)}
              className="w-24 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="btn btn-ghost">{t("common.cancel")}</button>
          <button onClick={handleSave} className="btn btn-primary">
            {isEdit ? t("common.save") : t("common.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
