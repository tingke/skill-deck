import { useState, useEffect, useMemo } from "react";
import { useSkillsStore } from "../stores/skills";
import { useExtensionsStore } from "../stores/extensions";
import { useWorkspaceStore } from "../stores/workspace";
import { saveAgent, deleteAgent, toggleAgent, pickFolder, getHomeDirectory } from "../lib/tauri";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import {
  Cpu,
  Plus,
  Trash2,
  Edit3,
  X,
  FolderOpen,
  Power,
  ChevronRight,
} from "lucide-react";
import { useViewMode } from "../lib/useViewMode";
import ViewToggle from "../components/ViewToggle";
import SearchInput from "../components/SearchInput";
import { ContentTitle } from "../components/PageHeader";
import type { AgentRow } from "../types";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";
import DetailDrawer from "../components/DetailDrawer";
import { AgentGlyph } from "../components/AgentGlyph";
import PageHeader from "../components/PageHeader";

const toast = () => useToastStore.getState();

/// 把选出的绝对路径转为 ~/ 相对路径展示（保持 DB 存储约定）。
function relativeToHome(abs: string, home = "") {
  const h = home.endsWith("/") ? home : home + "/";
  return abs.startsWith(h) ? abs.slice(h.length) : abs;
}


export default function AgentsView() {
  const t = useT();
  const { agents, loadAgents } = useWorkspaceStore();
  const skills = useSkillsStore((s) => s.skills);
  const extensions = useExtensionsStore((s) => s.extensions);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode("agents");
  const [query, setQuery] = useState("");
  const deleteConfirmation = useDeleteConfirmation();
  const detailAgent = detailId ? agents.find((a) => a.id === detailId) ?? null : null;
  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? agents
      : agents.filter(
          (a) => a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
        );
    // 本机已安装优先展示，未安装的沉底（组内保持原排序）
    return [...matched].sort((a, b) => Number(b.installed) - Number(a.installed));
  }, [agents, query]);

  const handleToggle = async (agent: AgentRow) => {
    try {
      await toggleAgent(agent.id, !agent.enabled);
      await loadAgents();
      await useSkillsStore.getState().loadAgentOptions();
    } catch (e) {
      toast().show(t("common.toggleFailed", { msg: String(e) }), "error");
    }
  };

  const handleDelete = async (agent: AgentRow) => {
    if (agent.capabilities.builtin) return;
    try {
      await deleteAgent(agent.id);
      await loadAgents();
      await useSkillsStore.getState().loadAgentOptions();
      toast().show(t("agents.deleted", { label: agent.label }), "info");
    } catch (e) {
      toast().show(t("common.deleteFailed", { msg: String(e) }), "error");
    }
  };

  const handleDeleteFromDetail = async (agent: AgentRow) => {
    await handleDelete(agent);
    setDetailId(null);
  };

  const countSkills = (agentId: string) =>
    skills.filter((s) => s.links.includes(agentId)).length;

  const countExt = (agentId: string, kind: string) =>
    extensions.filter((e) => e.runtime === agentId && e.kind === kind).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        toolbar={
          <>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <SearchInput value={query} onChange={setQuery} placeholder={t("agents.search")} />
          </>
        }
        actions={
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus size={14} /> {t("agents.add")}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <ContentTitle title={t("agents.title")} meta={t("agents.desc")} />
        {viewMode === "list" ? (
          <div className="list-panel mx-6 mb-6">
            {filteredAgents.map((a) => (
              <div
                key={a.id}
                onClick={() => setDetailId(a.id)}
                className={"list-row list-row--generic" + (a.enabled ? "" : " opacity-60")}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <AgentGlyph id={a.id} label={a.label} size={18} active={a.enabled} />
                  <span className="list-row__name">{a.label}</span>
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  {[
                    { key: "skills", count: countSkills(a.id), show: true },
                    { key: "mcp", count: countExt(a.id, "mcp"), show: !!a.capabilities.mcp },
                    { key: "plugins", count: countExt(a.id, "plugin"), show: a.capabilities.plugins },
                    { key: "hooks", count: countExt(a.id, "hook"), show: a.capabilities.hooks },
                  ].filter((s) => s.show).map((s) => (
                    <span key={s.key} className={`badge shrink-0 tnum ${s.count === 0 ? "bg-surface-2 text-faint" : "bg-accent-soft text-accent"}`}>
                      {s.count} {s.key}
                    </span>
                  ))}
                </span>
                <span className={`badge shrink-0 font-medium ${a.enabled ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400" : "text-faint bg-surface-2"}`}>
                  {a.enabled ? t("common.enabled") : t("common.disabled")}
                </span>
                {!a.installed && (
                  <span className="badge shrink-0 bg-surface-2 text-faint">{t("agents.notInstalled")}</span>
                )}
                <ChevronRight size={14} className="list-row__chev" />
              </div>
            ))}
          </div>
        ) : (
        <div className="px-6 pb-6 card-grid">
          {filteredAgents.map((a) => {
            return (
              <div
                key={a.id}
                onClick={() => setDetailId(a.id)}
                className={`card p-4 flex flex-col ${a.enabled ? "" : "opacity-60"} cursor-pointer`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentGlyph id={a.id} label={a.label} size={30} active={a.enabled} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-heading truncate">
                        {a.label}
                        {a.auto_scan && (
                          <span className="ml-1.5 text-[11px] font-normal text-faint border border-border-strong rounded px-1 py-0.5">
                            auto-scan
                          </span>
                        )}
                      </h3>
                      <code className="text-[12px] text-faint font-mono">{a.sort_order}</code>
                    </div>
                  </div>
                  <span className={`badge shrink-0 font-medium ${a.enabled ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400" : "text-faint bg-surface-2"}`}>
                    {a.enabled ? t("common.enabled") : t("common.disabled")}
                  </span>
                  {!a.installed && (
                    <span className="badge shrink-0 bg-surface-2 text-faint">{t("agents.notInstalled")}</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {[
                    { key: "skills", count: countSkills(a.id), show: true, hot: countSkills(a.id) > 0 },
                    { key: "mcp", count: countExt(a.id, "mcp"), show: !!a.capabilities.mcp, hot: countExt(a.id, "mcp") > 0 },
                    { key: "plugins", count: countExt(a.id, "plugin"), show: a.capabilities.plugins, hot: countExt(a.id, "plugin") > 0 },
                    { key: "hooks", count: countExt(a.id, "hook"), show: a.capabilities.hooks, hot: countExt(a.id, "hook") > 0 },
                  ].filter((s) => s.show).map((s) => (
                    <span key={s.key} className={`badge tnum ${s.hot ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"}`}>
                      {s.count} {s.key}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        )}

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
         await useSkillsStore.getState().loadAgentOptions();
         setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-agent-dialog" />

      <DetailDrawer
        open={!!detailAgent}
        onClose={() => setDetailId(null)}
        testId="agent-detail-drawer"
        icon={
          detailAgent ? (
            <AgentGlyph id={detailAgent.id} label={detailAgent.label} size={30} active={detailAgent.enabled} />
          ) : undefined
        }
        title={detailAgent?.label ?? ""}
        subtitle={
          <span className="flex items-center gap-1.5 flex-wrap">
            <span>{detailAgent?.id}</span>
            <span className={detailAgent?.enabled ? "text-emerald-500" : ""}>
              · {detailAgent?.enabled ? t("common.enabled") : t("common.disabled")}
            </span>
          </span>
        }
        actions={
          detailAgent && (
            <>
              <button
                onClick={() => handleToggle(detailAgent)}
                className={
                  "btn-icon rounded-full bg-surface-2 " +
                  (detailAgent.enabled ? "text-accent" : "text-faint")
                }
                title={detailAgent.enabled ? t("agents.disableAction") : t("agents.enableAction")}
                aria-label={detailAgent.enabled ? t("agents.disableAction") : t("agents.enableAction")}
              >
                <Power size={14} />
              </button>
              <button
                onClick={() => setEditing(detailAgent)}
                className="btn-icon rounded-full bg-surface-2"
                title={t("common.edit")}
                aria-label={t("common.edit")}
              >
                <Edit3 size={14} />
              </button>
              {!detailAgent.capabilities.builtin && (
                <button
                  onClick={() => deleteConfirmation.request(detailAgent.label, () => handleDeleteFromDetail(detailAgent))}
                  className="btn-icon rounded-full bg-surface-2 text-red-500 hover:text-red-600"
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )
        }
      >
        {detailAgent && (
          <>
            {/* Paths + stats */}
            <section className="px-5 py-3.5 border-b border-border-subtle space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-faint w-20 shrink-0">{t("agents.detailSkillsDir")}</span>
                <code className="font-mono text-muted truncate">~/{detailAgent.skills_dir}</code>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-faint w-20 shrink-0">{t("agents.detailConfigDir")}</span>
                <code className="font-mono text-muted truncate">~/{detailAgent.config_dir}</code>
              </div>
              {detailAgent.capabilities.mcp && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-faint w-20 shrink-0">{t("agents.detailMcpFile")}</span>
                  <code className="font-mono text-muted truncate">{detailAgent.mcp_config_file || t("common.none")}</code>
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                {[
                  { key: "skills", count: countSkills(detailAgent.id), show: true },
                  { key: "mcp", count: countExt(detailAgent.id, "mcp"), show: !!detailAgent.capabilities.mcp },
                  { key: "plugins", count: countExt(detailAgent.id, "plugin"), show: detailAgent.capabilities.plugins },
                  { key: "hooks", count: countExt(detailAgent.id, "hook"), show: detailAgent.capabilities.hooks },
                ].filter((s) => s.show).map((s) => (
                  <span key={s.key} className={`badge tnum ${s.count === 0 ? "bg-surface-2 text-faint" : "bg-accent-soft text-accent"}`}>
                    {s.count} {s.key}
                  </span>
                ))}
              </div>
            </section>

            {/* Options */}
            <section className="px-5 py-3.5 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`badge ${detailAgent.auto_scan ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-surface-2 text-faint"}`}>
                  {t("agents.autoScanLabel")}
                </span>
                <span className={`badge ${detailAgent.scan_agents_dir ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-surface-2 text-faint"}`}>
                  {t("agents.scanAgentsDirLabel")}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-faint w-20 shrink-0">{t("common.sortOrder")}</span>
                <span className="text-muted font-mono">{detailAgent.sort_order}</span>
              </div>
            </section>
          </>
        )}
      </DetailDrawer>
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
  const [id] = useState(editing?.id || "");
  const [label, setLabel] = useState(editing?.label || "");
  const [skillsDir, setSkillsDir] = useState(editing?.skills_dir || "");
  const [configDir, setConfigDir] = useState(editing?.config_dir || "");
  const [mcpFile, setMcpFile] = useState(editing?.mcp_config_file || "");
 const [autoScan, setAutoScan] = useState(editing?.auto_scan || false);
 const [scanAgentsDir, setScanAgentsDir] = useState(editing?.scan_agents_dir || false);
 const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 99);
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [home, setHome] = useState("");
  useEffect(() => { getHomeDirectory().then(setHome).catch(() => {}); }, []);

  const isEditing = !!editing;

  // 新建时从显示名自动生成 ID：中文转拼音不可行，直接 slugify；
  // 全中文等无 ASCII 字符时回退 "agent"，与既有 id 冲突时追加数字。
  const autoId = () => {
    const slug = label.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!slug) return "agent";
    const existing = new Set(useWorkspaceStore.getState().agents.map((a) => a.id));
    if (!existing.has(slug)) return slug;
    let n = 2;
    while (existing.has(`${slug}-${n}`)) n++;
    return `${slug}-${n}`;
  };

  const handleSave = async () => {
    if (!label.trim()) {
      toast().show(t("agents.idNameRequired"), "error");
      return;
    }
    if (!skillsDir.trim()) {
      toast().show(t("agents.skillsDirRequired"), "error");
      return;
    }
    const agentId = isEditing ? id : autoId();
    const agent: AgentRow = {
      id: agentId,
      label: label.trim(),
      skills_dir: skillsDir.trim(),
      config_dir: configDir.trim() || skillsDir.trim(),
      mcp_config_file: mcpFile.trim(),
      auto_scan: autoScan,
      scan_agents_dir: scanAgentsDir,
      enabled,
      sort_order: sortOrder,
      // 新登记的 Agent 由后端按本机目录重新检测；这里先给真值避免闪烁
      installed: true,
      capabilities: editing?.capabilities ?? {
        skills: true,
        mcp: mcpFile.trim() ? "json_servers" : null,
        hooks: false,
        plugins: false,
        rules: null,
        activity: false,
        builtin: false,
      },
    };
    try {
      await saveAgent(agent);
      // 编辑已有 agent 时 enabled 不随 UPSERT 保存，单独走 toggle。
      if (isEditing && editing && editing.enabled !== enabled) {
        await toggleAgent(agentId, enabled);
      }
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
          <div>
            <label className="text-[13px] text-faint mb-1 block">{t("agents.displayLabel")}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("agents.displayPlaceholder")}
              className="input"
            />
            {isEditing && (
              <p className="text-2xs text-faint mt-1 font-mono">{id}</p>
            )}
          </div>

          <div>
            <label className="text-[13px] text-faint mb-1 block">{t("agents.skillsDir")}</label>
            <div className="flex gap-1.5">
              <input
                value={skillsDir}
                onChange={(e) => setSkillsDir(e.target.value)}
                placeholder=".cursor/skills"
                className="input input-mono flex-1"
              />
              <button
                onClick={async () => {
                  const dir = await pickFolder();
                  if (!dir) return;
                  setSkillsDir(relativeToHome(dir, home));
                  if (!configDir.trim()) setConfigDir(relativeToHome(dir.replace(/\/skills\/?$/, ""), home));
                }}
                className="btn-icon shrink-0"
                title={t("agents.pickDir")}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] text-faint mb-1 block">{t("agents.configDir")}</label>
              <div className="flex gap-1.5">
                <input
                  value={configDir}
                  onChange={(e) => setConfigDir(e.target.value)}
                  placeholder=".cursor"
                  className="input input-mono flex-1 min-w-0"
                />
                <button
                  onClick={async () => {
                    const dir = await pickFolder();
                    if (dir) setConfigDir(relativeToHome(dir, home));
                  }}
                  className="btn-icon shrink-0"
                  title={t("agents.pickDir")}
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            </div>
            <div>
              <label className="text-[13px] text-faint mb-1 block">{t("agents.mcpFile")}</label>
              <input
                value={mcpFile}
                onChange={(e) => setMcpFile(e.target.value)}
                placeholder="mcp.json"
                className="input input-mono"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[13px] text-faint mb-1 block">{t("common.sortOrder")}</label>
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

         <label className="flex items-center gap-2 cursor-pointer">
           <input
             type="checkbox"
             checked={enabled}
             onChange={(e) => setEnabled(e.target.checked)}
             className="w-4 h-4 accent-slate-900"
           />
           <span className="text-sm text-muted">
             {enabled ? t("common.enabled") : t("common.disabled")}
             <span className="text-2xs text-faint ml-1.5">{t("agents.enabledLabel")}</span>
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
