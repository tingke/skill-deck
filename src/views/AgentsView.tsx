import { useState } from "react";
import { useAppStore } from "../stores/app";
import { saveAgent, deleteAgent, toggleAgent } from "../lib/tauri";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import {
  Cpu,
  Plus,
  Trash2,
  Edit3,
  X,
  FolderTree,
  FileCog,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import type { AgentRow } from "../types";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";
import { AgentGlyph } from "../components/AgentGlyph";

const toast = () => useToastStore.getState();

const COLOR_MAP: Record<string, { dot: string; text: string; border: string }> = {
  orange: { dot: "bg-orange-500", text: "text-orange-600", border: "border-orange-300" },
  green: { dot: "bg-green-500", text: "text-green-600", border: "border-green-300" },
  blue: { dot: "bg-sky-500", text: "text-sky-600", border: "border-sky-300" },
  violet: { dot: "bg-violet-500", text: "text-violet-600", border: "border-violet-300" },
  slate: { dot: "bg-muted", text: "text-muted", border: "border-border-strong" },
  red: { dot: "bg-red-500", text: "text-red-600", border: "border-red-300" },
  amber: { dot: "bg-amber-500", text: "text-amber-600", border: "border-amber-300" },
  cyan: { dot: "bg-cyan-500", text: "text-cyan-600", border: "border-cyan-300" },
};

function colorOf(c: string) {
  return COLOR_MAP[c] || COLOR_MAP.slate;
}

export default function AgentsView() {
  const t = useT();
  const { agents, skills, loadAgents } = useAppStore();
  const extensions = useAppStore((s) => s.extensions);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteConfirmation = useDeleteConfirmation();

  const handleToggle = async (agent: AgentRow) => {
    try {
      await toggleAgent(agent.id, !agent.enabled);
      await loadAgents();
      await useAppStore.getState().loadAgentOptions();
    } catch (e) {
      toast().show(t("common.toggleFailed", { msg: String(e) }), "error");
    }
  };

  const handleDelete = async (agent: AgentRow) => {
    if (agent.id === "claude" || agent.id === "codex") return;
    try {
      await deleteAgent(agent.id);
      await loadAgents();
      await useAppStore.getState().loadAgentOptions();
      toast().show(t("agents.deleted", { label: agent.label }), "info");
    } catch (e) {
      toast().show(t("common.deleteFailed", { msg: String(e) }), "error");
    }
  };

  const countSkills = (agentId: string) =>
    skills.filter((s) => s.links.includes(agentId)).length;

  const countExt = (agentId: string, kind: string) =>
    extensions.filter((e) => e.runtime === agentId && e.kind === kind).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
        <div className="text-xs text-faint">
          {t("agents.desc")}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn btn-primary shrink-0 ml-3"
        >
          <Plus size={14} /> {t("agents.add")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-6">
        <div className="grid grid-cols-2 gap-3">
          {agents.map((a) => {
            const c = colorOf(a.color);
            const isBuiltin = a.id === "claude" || a.id === "codex";
            return (
              <div
                key={a.id}
                className={`card p-4 flex flex-col ${
                  a.enabled ? "" : "opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentGlyph id={a.id} label={a.label} size={30} active={a.enabled} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-heading truncate">
                        {a.label}
                        {a.auto_scan && (
                          <span className="ml-1.5 text-[9px] font-normal text-faint border border-border-strong rounded px-1 py-0.5">
                            auto-scan
                          </span>
                        )}
                      </h3>
                      <code className="text-[10px] text-faint font-mono">{a.id}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => handleToggle(a)}
                      title={a.enabled ? t("agents.enableHint") : t("agents.disableHint")}
                      className={`p-1 ${a.enabled ? "text-emerald-500" : "text-faint"}`}
                    >
                      {a.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                    <button
                      onClick={() => setEditing(a)}
                      title={t("common.edit")}
                      className="btn-icon"
                    >
                      <Edit3 size={14} />
                    </button>
                    {!isBuiltin && (
                      <button
                        onClick={() => deleteConfirmation.request(a.label, () => handleDelete(a))}
                        title={t("common.delete")}
                        className="btn-icon btn-icon-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <FolderTree size={12} className="shrink-0 text-faint" />
                    <code className="font-mono truncate">~/{a.skills_dir}</code>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <FileCog size={12} className="shrink-0 text-faint" />
                    <code className="font-mono truncate">~/{a.config_dir}/{a.mcp_config_file || t("common.none")}</code>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3 text-[11px]">
                  <span className="text-faint">
                    <span className={`font-semibold ${c.text}`}>{countSkills(a.id)}</span> skills
                  </span>
                  <span className="text-faint">
                    <span className={`font-semibold ${c.text}`}>{countExt(a.id, "mcp")}</span> mcp
                  </span>
                  <span className="text-faint">
                    <span className={`font-semibold ${c.text}`}>{countExt(a.id, "plugin")}</span> plugins
                  </span>
                  <span className="text-faint">
                    <span className={`font-semibold ${c.text}`}>{countExt(a.id, "hook")}</span> hooks
                  </span>
                  <span className={`badge font-medium ${a.enabled ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400" : "text-faint bg-surface-2"}`}>
                    {a.enabled ? t("common.enabled") : t("common.disabled")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-faint">
            <Cpu size={48} />
            <p className="text-sm mt-3">{t("agents.empty")}</p>
            <p className="text-xs mt-1">{t("agents.emptyHint")}</p>
          </div>
        )}
      </div>

      {(creating || editing) && (
        <AgentEditor
          editing={editing}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
       onDone={async () => {
         await loadAgents();
         await useAppStore.getState().loadAgentOptions();
         setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-agent-dialog" />
    </div>
  );
}

function AgentEditor({
  editing,
  t,
  onClose,
  onDone,
}: {
  editing: AgentRow | null;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [id, setId] = useState(editing?.id || "");
  const [label, setLabel] = useState(editing?.label || "");
  const [skillsDir, setSkillsDir] = useState(editing?.skills_dir || "");
  const [configDir, setConfigDir] = useState(editing?.config_dir || "");
  const [mcpFile, setMcpFile] = useState(editing?.mcp_config_file || "");
  const [color, setColor] = useState(editing?.color || "slate");
 const [autoScan, setAutoScan] = useState(editing?.auto_scan || false);
 const [scanAgentsDir, setScanAgentsDir] = useState(editing?.scan_agents_dir || false);
 const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 99);
 // 编辑时保留原启用状态（后端 UPSERT 会无条件覆盖 enabled）
 const enabled = editing?.enabled ?? true;

  const isEditing = !!editing;

  const handleSave = async () => {
    if (!id.trim() || !label.trim()) {
      toast().show(t("agents.idNameRequired"), "error");
      return;
    }
    if (!skillsDir.trim()) {
      toast().show(t("agents.skillsDirRequired"), "error");
      return;
    }
    const agent: AgentRow = {
      id: id.trim().toLowerCase().replace(/\s+/g, "-"),
      label: label.trim(),
      skills_dir: skillsDir.trim(),
      config_dir: configDir.trim() || skillsDir.trim(),
      mcp_config_file: mcpFile.trim(),
     color,
     auto_scan: autoScan,
     scan_agents_dir: scanAgentsDir,
     enabled,
     sort_order: sortOrder,
    };
    try {
      await saveAgent(agent);
      toast().show(isEditing ? t("agents.saved") : t("agents.created"));
      onDone();
    } catch (e) {
      toast().show(t("common.saveFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-surface rounded-2xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold dark:text-heading">
            {isEditing ? t("agents.editTitle") : t("agents.addTitle")}
          </h3>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("agents.idLabel")}</label>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                disabled={isEditing}
                placeholder={t("agents.idPlaceholder")}
                className="input input-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("agents.displayLabel")}</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("agents.displayPlaceholder")}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("agents.skillsDir")}</label>
            <input
              value={skillsDir}
              onChange={(e) => setSkillsDir(e.target.value)}
              placeholder=".cursor/skills"
              className="input input-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("agents.configDir")}</label>
              <input
                value={configDir}
                onChange={(e) => setConfigDir(e.target.value)}
                placeholder=".cursor"
                className="input input-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("agents.mcpFile")}</label>
              <input
                value={mcpFile}
                onChange={(e) => setMcpFile(e.target.value)}
                placeholder="mcp.json"
                className="input input-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("common.color")}</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Object.entries(COLOR_MAP).map(([name, c]) => (
                  <button
                    key={name}
                    onClick={() => setColor(name)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      color === name ? "scale-110 ring-2 ring-offset-1 dark:ring-offset-surface ring-border-strong" : "border-transparent"
                    } ${c.dot}`}
                    title={name}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-faint mb-1 block">{t("common.sortOrder")}</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                className="input input-mono"
              />
            </div>
          </div>

         <label className="flex items-center gap-2 cursor-pointer">
           <input
             type="checkbox"
             checked={autoScan}
             onChange={(e) => setAutoScan(e.target.checked)}
             className="w-4 h-4 accent-slate-900"
           />
           <span className="text-sm text-muted">
             {t("agents.autoScanLabel")}
           </span>
         </label>

         <label className="flex items-center gap-2 cursor-pointer">
           <input
             type="checkbox"
             checked={scanAgentsDir}
             onChange={(e) => setScanAgentsDir(e.target.checked)}
             className="w-4 h-4 accent-slate-900"
           />
           <span className="text-sm text-muted">
             {t("agents.scanAgentsDirLabel")}
           </span>
         </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
          >
            {isEditing ? t("common.save") : t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
