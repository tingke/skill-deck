import { useState, useMemo, useEffect } from "react";
import { useAppStore } from "../stores/app";
import {
  savePkg,
  deletePkg,
  applyPkg,
  exportPkg,
  getPackage,
  applyPkgToProject,
  pickFolder,
  revealInFinder,
  pickSaveFolder,
  saveProject,
} from "../lib/tauri";
import {
  Package as PackageIcon,
  Plus,
  Trash2,
  X,
  Search,
  Play,
  Download,
  Edit3,
  Server,
  FileText,
  BookOpen,
  FolderOpen,
} from "lucide-react";
import type {
  PackageRow,
  PackageDetail,
  PackageInput,
  PackageSkillInput,
  PackageMcpInput,
  PackageConfigInput,
 AgentInfo,
 Skill,
} from "../types";
import type { ExtensionRow, Rule } from "../types";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";
import { AgentGlyph } from "../components/AgentGlyph";

const toast = () => useToastStore.getState();

export default function PackagesView() {
  const t = useT();
  const { packages, agentOptions, skills, loadPackages } = useAppStore();
  const { extensions, rules } = useAppStore();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteConfirmation = useDeleteConfirmation();
  const filtered = packages.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.display_name.toLowerCase().includes(query.toLowerCase()) ||
      p.description.toLowerCase().includes(query.toLowerCase()),
  );

  const handleApply = async (pkg: PackageRow, agentId: string) => {
    try {
      await applyPkg(pkg.id, agentId);
      await useAppStore.getState().loadActivity();
      toast().show(t("packages.appliedTo", { name: pkg.display_name || pkg.name, agent: agentId }));
    } catch (e) {
      toast().show(t("packages.applyFailed", { msg: String(e) }), "error");
    }
  };

  const handleApplyToProject = async (pkg: PackageRow) => {
    try {
      const folder = await pickFolder();
      if (!folder) return;
      await applyPkgToProject(pkg.id, folder);
      const projName = folder.split("/").pop() || "untitled";
      await saveProject({ id: "", name: projName, path: folder, color: "slate", sort_order: 0, skill_count: 0, created_at: "", updated_at: "" });
      await useAppStore.getState().loadProjects();
      await useAppStore.getState().loadActivity();
      toast().show(t("packages.appliedToProject", { name: folder.split("/").pop() || "" }));
    } catch (e) {
      toast().show(t("packages.applyFailed", { msg: String(e) }), "error");
    }
  };

  const handleDelete = async (id: string) => {
    await deletePkg(id);
    await loadPackages();
    toast().show(t("packages.deleted"), "info");
  };

  const handleExport = async (pkg: PackageRow) => {
    try {
      const dest = await pickSaveFolder();
      if (!dest) return;
      const path = await exportPkg(pkg.id, dest);
      toast().show(t("packages.exported", { name: path.split("/").pop() || "" }));
      revealInFinder(path);
    } catch (e) {
      toast().show(t("packages.exportFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
     <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
       <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("packages.search")}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setCreating(true)}
            className="btn btn-primary"
          >
            <Plus size={14} /> {t("packages.new")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-6">
        <div className="mb-4 text-xs text-muted">
          {t("packages.desc")}
          <code className="mx-1 px-1 bg-surface-2 rounded">.ai-package.zip</code>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-faint">
            <PackageIcon size={48} />
            <p className="text-sm mt-3">{t("packages.empty")}</p>
            <p className="text-xs mt-1">{t("packages.emptyHint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((p) => (
              <PackageCard
                key={p.id}
                pkg={p}
                agentOptions={agentOptions}
                t={t}
                onApply={handleApply}
                onApplyToProject={() => handleApplyToProject(p)}
                onEdit={() => setEditingId(p.id)}
                onDelete={() => deleteConfirmation.request(p.display_name || p.name, () => handleDelete(p.id))}
                onExport={() => handleExport(p)}
              />
            ))}
          </div>
        )}
      </div>

      {(creating || editingId) && (
        <PackageEditor
          skills={skills}
          agentOptions={agentOptions}
          extensions={extensions}
          rules={rules}
          editingId={editingId}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onDone={async () => {
            await loadPackages();
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-package-dialog" />
    </div>
  );
}

function PackageCard({
  pkg,
  agentOptions,
  t,
  onApply,
  onApplyToProject,
  onEdit,
  onDelete,
  onExport,
}: {
  pkg: PackageRow;
  agentOptions: AgentInfo[];
  t: ReturnType<typeof useT>;
  onApply: (p: PackageRow, r: string) => void;
  onApplyToProject: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [applyMenu, setApplyMenu] = useState(false);
  const title = pkg.display_name || pkg.name;
  return (
    <div className="card p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-heading truncate">{title}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-faint font-mono">v{pkg.version}</span>
            {pkg.description && (
              <span className="text-[11px] text-muted truncate">{pkg.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onEdit} title={t("common.edit")} className="btn-icon">
            <Edit3 size={14} />
          </button>
          <button onClick={onDelete} title={t("common.delete")} className="btn-icon btn-icon-danger">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 text-[11px] text-faint">
        <span className="flex items-center gap-0.5"><BookOpen size={11} /> {pkg.skill_count}</span>
        <span className="flex items-center gap-0.5"><Server size={11} /> {pkg.mcp_count}</span>
        <span className="flex items-center gap-0.5"><FileText size={11} /> {pkg.config_count}</span>
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <div className="relative">
          <button
            onClick={() => setApplyMenu((v) => !v)}
            className="btn btn-primary btn-sm"
          >
            <Play size={12} /> {t("packages.applyTo")}
          </button>
          {applyMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setApplyMenu(false)} />
              <div className="absolute bottom-full mb-1 left-0 z-20 bg-surface border border-border-strong rounded-lg shadow-lg py-0.5 min-w-[100px]">
                {agentOptions.map((rt) => (
                  <button
                    key={rt.id}
                    onClick={() => {
                      onApply(pkg, rt.id);
                      setApplyMenu(false);
                    }}
                   className="w-full text-left px-2.5 py-1 text-xs text-muted hover:bg-surface-hover"
                 >
                   <span className="flex items-center gap-1.5">
                     <AgentGlyph id={rt.id} label={rt.label} size={16} />
                     <span className="truncate">{rt.label}</span>
                   </span>
                 </button>
               ))}
               <div className="border-t border-border-subtle dark:border-border-strong my-0.5" />
               <button
                 onClick={() => {
                   onApplyToProject();
                   setApplyMenu(false);
                 }}
                 className="w-full flex items-center gap-1.5 text-left px-2.5 py-1 text-xs text-muted hover:bg-surface-hover"
               >
                 <FolderOpen size={11} /> {t("packages.projectDir")}
               </button>
              </div>
            </>
          )}
        </div>
        <button onClick={onExport} title="zip" className="btn btn-outline btn-sm">
          <Download size={12} />
        </button>
      </div>
    </div>
  );
}

// ============ Editor ============

function PackageEditor({
  skills,
  agentOptions,
  extensions,
  rules,
  editingId,
  t,
  onClose,
  onDone,
}: {
  skills: Skill[];
  agentOptions: AgentInfo[];
  extensions: ExtensionRow[];
  rules: Rule[];
  editingId: string | null;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onDone: () => void;
}) {
  const availableMcps = extensions.filter((e) => e.kind === "mcp");
  const availableRules = rules;
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [description, setDescription] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [mcps, setMcps] = useState<PackageMcpInput[]>([]);
  const [configs, setConfigs] = useState<PackageConfigInput[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!!editingId);
  const [tab, setTab] = useState<"skills" | "mcps" | "configs">("skills");

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    (async () => {
      try {
        const d: PackageDetail = await getPackage(editingId);
        if (cancelled) return;
        setName(d.name);
        setDisplayName(d.display_name);
        setVersion(d.version);
        setDescription(d.description);
        setSelectedSkillIds(new Set(d.skills.map((s) => s.skill_id).filter(Boolean) as string[]));
        setMcps(d.mcps.map((m) => ({ name: m.name, config_json: m.config_json })));
        setConfigs(
          d.configs.map((c) => ({
            agent: c.agent,
            category: c.category,
            file_name: c.file_name,
            content: c.content,
          })),
        );
      } catch (e) {
        if (!cancelled) toast().show(t("packages.loadFailed", { msg: String(e) }), "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 仅在切换编辑目标时加载；t 每次渲染都是新引用，不能作为依赖，
    // 否则父组件任何重渲染都会重拉数据并覆盖用户未保存的输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const filteredSkills = useMemo(() => {
    if (!query.trim()) return skills;
    const q = query.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast().show(t("packages.nameRequired"), "error");
      return;
    }
    const skillInputs: PackageSkillInput[] = skills
      .filter((s) => selectedSkillIds.has(s.id))
      .map((s) => ({ name: s.name, skill_id: s.id, source_path: s.path }));
    const input: PackageInput = {
      name: name.trim(),
      display_name: displayName.trim(),
      version: version.trim() || "0.1.0",
      description: description.trim(),
      skills: skillInputs,
      mcps,
      configs,
    };
    try {
      await savePkg(input, editingId);
      toast().show(editingId ? t("packages.saved") : t("packages.created"));
      onDone();
    } catch (e) {
      toast().show(t("common.saveFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-surface rounded-2xl shadow-2xl w-[760px] h-[85vh] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold dark:text-heading">{editingId ? t("packages.editTitle") : t("packages.newTitle")}</h3>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-faint">{t("common.loading")}</div>
        ) : (
          <>
            <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b border-border-subtle">
              <div>
                <label className="text-[11px] text-faint mb-1 block">{t("packages.nameLabel")}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("packages.namePlaceholder")}
                  className="input"
                />
              </div>
              <div>
                <label className="text-[11px] text-faint mb-1 block">{t("packages.displayNameLabel")}</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("packages.displayNamePlaceholder")}
                  className="input"
                />
              </div>
              <div>
                <label className="text-[11px] text-faint mb-1 block">{t("packages.versionLabel")}</label>
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="input input-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-faint mb-1 block">{t("packages.descLabel")}</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("packages.descPlaceholder")}
                  className="input"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 px-5 py-2 border-b border-border-subtle">
              <TabBtn active={tab === "skills"} onClick={() => setTab("skills")} icon={<BookOpen size={12} />} label={t("packages.tabSkills", { count: selectedSkillIds.size })} />
              <TabBtn active={tab === "mcps"} onClick={() => setTab("mcps")} icon={<Server size={12} />} label={t("packages.tabMcp", { count: mcps.length })} />
              <TabBtn active={tab === "configs"} onClick={() => setTab("configs")} icon={<FileText size={12} />} label={t("packages.tabRules", { count: configs.length })} />
            </div>

            <div className="flex-1 overflow-y-auto min-h-[320px]">
              {tab === "skills" && (
                <div className="px-5 py-3">
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-3 top-2.5 text-faint" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("skills.search")}
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content"
                    />
                  </div>
                  {filteredSkills.map((s) => (
                    <label key={s.id} className="flex items-start gap-2 py-1.5 cursor-pointer hover:bg-surface-hover rounded px-2 -mx-2">
                      <input
                        type="checkbox"
                        checked={selectedSkillIds.has(s.id)}
                        onChange={() => toggleSkill(s.id)}
                        className="w-4 h-4 mt-0.5 accent-slate-900 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm text-content">{s.name}</span>
                          <span className="text-[10px] text-faint">{s.source_lib}</span>
                        </div>
                        {s.description && <p className="text-xs text-faint mt-0.5 line-clamp-1">{s.description}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {tab === "mcps" && <McpTab mcps={mcps} setMcps={setMcps} agentOptions={agentOptions} availableMcps={availableMcps} t={t} />}
              {tab === "configs" && <ConfigsTab configs={configs} setConfigs={setConfigs} agentOptions={agentOptions} availableRules={availableRules} t={t} />}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
              <span className="text-xs text-faint">
                {t("packages.summary", { skills: selectedSkillIds.size, mcps: mcps.length, configs: configs.length })}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="btn btn-ghost">
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  className="btn btn-primary"
                >
                  {editingId ? t("common.save") : t("common.create")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={"flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors " + (active ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-hover")}
    >
      {icon}
      {label}
    </button>
  );
}

function McpTab({
  mcps,
  setMcps,
  agentOptions,
  availableMcps,
  t,
}: {
  mcps: PackageMcpInput[];
  setMcps: (m: PackageMcpInput[]) => void;
  agentOptions: AgentInfo[];
  availableMcps: ExtensionRow[];
  t: ReturnType<typeof useT>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const existingNames = new Set(mcps.map((m) => m.name));
  const candidates = availableMcps.filter((e) => !existingNames.has(e.name));
  const updateMcp = (i: number, patch: Partial<PackageMcpInput>) => {
    const next = [...mcps];
    next[i] = { ...next[i], ...patch };
    setMcps(next);
  };

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => setMcps([...mcps, { name: `mcp-${mcps.length + 1}`, config_json: '{\n  "command": "",\n  "args": [],\n  "env": {}\n}' }])}
          className="flex items-center gap-1 text-xs text-muted hover:text-content dark:hover:text-content"
        >
          <Plus size={13} /> {t("packages.manualAdd")}
        </button>
        {candidates.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted hover:text-content dark:hover:text-content"
            >
              <Plus size={13} /> {t("packages.fromExistingMcp")}
            </button>
            {showPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPicker(false)} />
                <div className="absolute top-full mt-1 left-0 z-20 bg-surface border border-border-strong rounded-lg shadow-lg py-0.5 min-w-[180px] max-h-[200px] overflow-y-auto">
                  {candidates.map((ext) => (
                    <button
                      key={ext.id}
                      onClick={() => {
                        setMcps([...mcps, { name: ext.name, config_json: ext.config_json }]);
                        setShowPicker(false);
                      }}
                      className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover"
                    >
                      <span>{ext.name}</span>
                      <span className="text-[10px] text-faint">{ext.runtime}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {mcps.map((m, i) => (
        <div key={i} className="border border-border rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={m.name}
              onChange={(e) => updateMcp(i, { name: e.target.value })}
              placeholder={t("packages.namePlaceholder2")}
              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-transparent dark:text-content"
            />
            <button
              onClick={() => setMcps(mcps.filter((_, idx) => idx !== i))}
              className="btn-icon btn-icon-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <textarea
            value={m.config_json}
            onChange={(e) => updateMcp(i, { config_json: e.target.value })}
            rows={5}
            placeholder='{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{}}'
            className="w-full px-2 py-1 text-[11px] border border-border rounded bg-page text-muted font-mono"
          />
          <div className="text-[10px] text-faint">
            {t("mcp.applyMergeHint", { agents: agentOptions.map((r) => r.label).join(" / ") })}
          </div>
        </div>
      ))}
    </div>
  );
}
function ConfigsTab({
  configs,
  setConfigs,
  agentOptions,
  availableRules,
  t,
}: {
  configs: PackageConfigInput[];
  setConfigs: (c: PackageConfigInput[]) => void;
  agentOptions: AgentInfo[];
  availableRules: Rule[];
  t: ReturnType<typeof useT>;
}) {
  const [showRulePicker, setShowRulePicker] = useState(false);
  const add = () => {
    const agent = agentOptions[0]?.id || "claude";
    setConfigs([...configs, { agent, category: "rules", file_name: agent === "claude" ? "CLAUDE.md" : "AGENTS.md", content: "" }]);
  };
  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={add}
          className="flex items-center gap-1 text-xs text-muted hover:text-content dark:hover:text-content"
        >
          <Plus size={13} /> {t("packages.manualAdd")}
        </button>
        {availableRules.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowRulePicker((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted hover:text-content dark:hover:text-content"
            >
              <Plus size={13} /> {t("packages.fromExistingRule")}
            </button>
            {showRulePicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowRulePicker(false)} />
                <div className="absolute top-full mt-1 left-0 z-20 bg-surface border border-border-strong rounded-lg shadow-lg py-0.5 min-w-[200px] max-h-[200px] overflow-y-auto">
                  {availableRules.map((rule) => (
                    <button
                      key={rule.id}
                      onClick={() => {
                        const agent = rule.platform || agentOptions[0]?.id || "claude";
                        const file_name = agent === "codex" ? "AGENTS.md" : "CLAUDE.md";
                        setConfigs([...configs, { agent, category: "rules", file_name, content: rule.content }]);
                        setShowRulePicker(false);
                      }}
                      className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover"
                    >
                      <span className="truncate">{rule.title}</span>
                      <span className="text-[10px] text-faint shrink-0">{rule.platform}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {configs.map((c, i) => (
        <div key={i} className="border border-border rounded-lg p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-[150px]">
              <AgentGlyph id={c.agent} label={c.agent} size={18} />
              <select
                value={c.agent}
                onChange={(e) => {
                  const next = [...configs];
                  const agent = e.target.value;
                  next[i] = { ...c, agent, file_name: agent === "claude" ? "CLAUDE.md" : "AGENTS.md" };
                  setConfigs(next);
                }}
                className="flex-1 min-w-0 px-2 py-1 text-xs border border-border rounded bg-transparent dark:text-content"
              >
                {agentOptions.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.label}</option>
                ))}
              </select>
            </div>
            <input
              value={c.file_name}
              onChange={(e) => {
                const next = [...configs];
                next[i] = { ...c, file_name: e.target.value };
                setConfigs(next);
              }}
              placeholder={t("packages.fileNamePlaceholder")}
              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-transparent dark:text-content font-mono"
            />
            <button
              onClick={() => setConfigs(configs.filter((_, idx) => idx !== i))}
              className="btn-icon btn-icon-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <textarea
            value={c.content}
            onChange={(e) => {
              const next = [...configs];
              next[i] = { ...c, content: e.target.value };
              setConfigs(next);
            }}
            rows={5}
            placeholder={t("packages.ruleContentPlaceholder")}
            className="w-full px-2 py-1.5 text-[11px] font-mono border border-border rounded bg-page text-muted focus:outline-none"
          />
          <div className="text-[10px] text-faint mt-0.5">
            {t("packages.applyMergeHint")} <code className="font-mono">~/.{c.agent}/{c.file_name}</code>
          </div>
        </div>
      ))}
    </div>
  );
}
