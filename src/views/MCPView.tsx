import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../stores/app";
import {
  toggleExt,
  saveMcpCmd,
  deleteExt,
  extConfigPath,
} from "../lib/tauri";
import { Server, Plus, X } from "lucide-react";
import type { ExtensionRow, McpServerInput, AgentInfo } from "../types";
import { ExtRow } from "../components/ExtList";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";

const toast = () => useToastStore.getState();

export default function MCPView() {
  const t = useT();
  const { agentOptions, loadExtensions } = useAppStore();
  const allExtensions = useAppStore((s) => s.extensions);
  const extensions = useMemo(
    () => allExtensions.filter((e) => e.kind === "mcp"),
    [allExtensions],
  );
  const extIds = extensions.map((e) => e.id).join(",");
  const [editing, setEditing] = useState<ExtensionRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [paths, setPaths] = useState<Record<string, string>>({});

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
        <h2 className="text-sm font-semibold text-content dark:text-heading">{t("mcp.title")}</h2>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setShowAdd(true)} className="btn btn-primary">
            <Plus size={14} /> {t("mcp.add")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-4">
        {extensions.length === 0 ? (
          <EmptyState icon={<Server size={40} />} text={t("mcp.empty")} hint={t("mcp.emptyHint")} />
        ) : (
          <div className="space-y-1.5">
            {extensions.map((ext) => (
              <ExtRow key={ext.id} ext={ext} kindPath={paths[ext.id]} onToggle={() => handleToggle(ext)} onDelete={() => handleDelete(ext)} onEdit={() => setEditing(ext)} />
            ))}
          </div>
        )}
      </div>

      {(showAdd || editing) && (
        <McpModal
          agentOptions={agentOptions}
          existing={editing}
          t={t}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onDone={async () => { await loadExtensions(); setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

export function EmptyState({ icon, text, hint }: { icon: React.ReactNode; text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-faint">
      {icon}
      <p className="text-sm mt-2">{text}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  );
}

export function McpModal({
  agentOptions,
  existing,
  t,
  onClose,
  onDone,
}: {
  agentOptions: AgentInfo[];
  existing: ExtensionRow | null;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = !!existing;
  const initAgentId = existing?.runtime || "claude";
  const initCfg = (() => {
    try { return JSON.parse(existing?.config_json || "{}"); } catch { return {}; }
  })();
  const [agentId, setAgentId] = useState(initAgentId);
  const [serverJson, setServerJson] = useState(
    existing?.name ? JSON.stringify({ [existing.name]: initCfg }, null, 2) : "",
  );

  const parseServerJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serverJson);
    } catch {
      throw new Error(t("mcp.invalidJson"));
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(t("mcp.serverObjectRequired"));
    }

    let servers = parsed as Record<string, unknown>;
    if (
      "mcpServers" in servers &&
      servers.mcpServers &&
      typeof servers.mcpServers === "object" &&
      !Array.isArray(servers.mcpServers)
    ) {
      servers = servers.mcpServers as Record<string, unknown>;
    }

    const entries = Object.entries(servers);
    if (entries.length !== 1) {
      throw new Error(t("mcp.oneServerRequired"));
    }

    const [name, config] = entries[0];
    if (!name.trim()) throw new Error(t("mcp.nameRequired"));
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(t("mcp.serverObjectRequired"));
    }

    return { name: name.trim(), config };
  };

  const handleSave = async () => {
    let parsed;
    try {
      parsed = parseServerJson();
    } catch (e) {
      toast().show(e instanceof Error ? e.message : String(e), "error");
      return;
    }

    const input: McpServerInput = {
      runtime: agentId,
      name: parsed.name,
      config_json: JSON.stringify(parsed.config),
      old_name: existing?.name,
    };
    try {
      await saveMcpCmd(input);
      toast().show(isEdit ? t("mcp.updated", { name: parsed.name }) : t("mcp.addedTo", { name: parsed.name, agent: agentId }));
      onDone();
    } catch (e) {
      toast().show(t(isEdit ? "mcp.updateFailed" : "mcp.addFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold dark:text-heading">{isEdit ? t("mcp.editTitle") : t("mcp.addTitle")}</h3>
          <button onClick={onClose} className="btn-icon"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={isEdit}
            className="w-36 px-2.5 py-1.5 text-sm border border-border rounded-lg bg-transparent dark:text-content disabled:opacity-60"
            aria-label={t("mcp.runtimeLabel")}
          >
            {agentOptions.filter((r) => r.id !== "trae").map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.label}</option>
            ))}
          </select>
          <div className="mt-3">
            <label className="text-[11px] text-faint mb-1 block" htmlFor="mcp-json">{t("mcp.jsonLabel")}</label>
            <textarea
              id="mcp-json"
              value={serverJson}
              onChange={(e) => setServerJson(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={t("mcp.jsonPlaceholder")}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content font-mono resize-y"
            />
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
