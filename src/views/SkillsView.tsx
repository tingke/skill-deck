import { useState, useMemo, useCallback, useEffect } from "react";
import { useAppStore } from "../stores/app";
import {
  Search, Folder, X, Check, Trash2,
  Tag as TagIcon, CheckSquare, Layers, Square,
  Power, FileText, Link2, Clock, ShieldCheck,
  FolderOpen, FolderClosed, ChevronRight, ChevronDown,
  FilePen, Cpu, Globe, User, Scale, ChevronUp,
  ExternalLink, Loader2, Plus,
  ArchiveRestore,
} from "lucide-react";
import type { Skill, AgentInfo, SkillFileEntry, SkillConnectionState } from "../types";
import { revealInFinder, readSkillFileByPath, batchConnect, getHomeDirectory } from "../lib/tauri";
import { getDisconnectableSkillIds } from "../lib/skillBatch";
import { formatSkillPath } from "../lib/skillPaths";
import { buildBatchSharedDisconnectConfirmation } from "../lib/connectionConfirmation";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { AgentGlyph } from "../components/AgentGlyph";

const ALL = "__all__";

// ---- Permission icon mapping ----
const PERM_ICONS: Record<string, { icon: typeof Cpu; label: string; color: string }> = {
  "exec": { icon: Cpu, label: "可执行", color: "text-amber-500" },
  "file:write": { icon: FilePen, label: "可写入", color: "text-blue-500" },
  "network": { icon: Globe, label: "可联网", color: "text-violet-500" },
};

// ---- Mini toggle (reuses .skill-toggle CSS) ----
function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="skill-toggle" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="skill-toggle-slider" />
    </label>
  );
}

// ---- Rail item ----
function RailItem({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rail-item " + (active ? "rail-item--active" : "")
      }
    >
      <span className="truncate">{label}</span>
      <span className={"rail-item-count " + (active ? "text-violet-500" : "")}>{count}</span>
    </button>
  );
}

// ---- Agent icon in table ----
function AgentIcon({ agent, linked }: { agent: AgentInfo; linked: boolean }) {
  return (
    <AgentGlyph
      id={agent.id}
      label={`${agent.label}${linked ? " · 已连接" : " · 未连接"}`}
      size={20}
      active={linked}
    />
  );
}

// ---- Permission badges ----
function PermissionBadges({ perms }: { perms: string[] }) {
  if (perms.length === 0) return <ShieldCheck size={13} className="inline text-faint opacity-40" />;
  return (
    <div className="flex items-center gap-0.5 justify-center">
      {perms.map((p) => {
        const cfg = PERM_ICONS[p];
        if (!cfg) return null;
        const Icon = cfg.icon;
        return <span key={p} title={cfg.label}><Icon size={11} className={cfg.color} /></span>;
      })}
    </div>
  );
}

// ---- Table row ----
function SkillTableRow({
  skill, agentOptions, selected, multiSelect, checked, onSelect, onToggleCheck,
}: {
  skill: Skill; agentOptions: AgentInfo[]; selected: boolean;
  multiSelect: boolean; checked: boolean;
  onSelect: () => void; onToggleCheck: () => void;
}) {
  return (
    <div
      onClick={multiSelect ? onToggleCheck : onSelect}
      className={
        "skills-table-grid relative grid items-center gap-2 px-4 py-2 border-b border-border-subtle cursor-pointer transition-colors " +
        (selected ? "bg-violet-50 dark:bg-violet-900/20" : "hover:bg-surface-hover dark:hover:bg-surface-hover") +
        (!skill.enabled ? " opacity-50" : "")
      }
    >
      {selected && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-violet-500" />}
      {multiSelect && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none">
          {checked ? <CheckSquare size={15} className="text-violet-500" /> : <Square size={15} className="text-faint" />}
        </div>
      )}
      <div className={"flex flex-col justify-center gap-1 min-w-0 " + (multiSelect ? "pl-5" : "")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="min-w-0 truncate text-sm font-semibold text-heading">{skill.name}</span>
          {!skill.enabled && <Power size={11} className="text-faint shrink-0" />}
        </div>
        {skill.tags.length > 0 && (
          <div
            className="flex items-center gap-1 flex-wrap min-w-0"
            title={skill.tags.join(", ")}
          >
            {skill.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-2xs max-w-[100px] truncate px-1.5 py-0.5 rounded bg-surface-2 text-muted font-medium"
              >
                {tag}
              </span>
            ))}
            {skill.tags.length > 3 && (
              <span className="text-2xs text-faint font-medium">+{skill.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-0.5">
        {agentOptions.map((agent) => (
          <AgentIcon key={agent.id} agent={agent} linked={skill.links.includes(agent.id)} />
        ))}
      </div>
      <div className="text-center"><PermissionBadges perms={skill.permissions} /></div>
      <div className="text-center"><Clock size={13} className="inline text-faint opacity-40" /></div>
      <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        <MiniToggle checked={skill.enabled} onChange={() => useAppStore.getState().toggleSkillEnabled(skill.id, !skill.enabled)} />
      </div>
    </div>
  );
}

// ---- Tag editor ----
function TagEditor({ skillId, tags }: { skillId: string; tags: string[] }) {
  const t = useT();
  const { updateTags } = useAppStore();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const addTag = () => {
    const value = text.trim();
    if (value && !tags.includes(value)) {
      updateTags(skillId, [...tags, value]);
    }
    setText("");
    setAdding(false);
  };

  const removeTag = (tag: string) => {
    updateTags(skillId, tags.filter((item) => item !== tag));
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTag();
            if (e.key === "Escape") { setText(""); setAdding(false); }
          }}
          placeholder="新标签"
          className="px-2 py-1 text-xs border border-border-strong rounded-md focus:outline-none focus:border-violet-400 flex-1 min-w-[140px]"
          autoFocus
        />
        <button onClick={addTag} className="p-1 text-emerald-500 hover:text-emerald-700"><Check size={14} /></button>
        <button
          onClick={() => { setText(""); setAdding(false); }}
          className="p-1 text-faint hover:text-content"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.length > 0 ? (
        tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-2xs pl-2 pr-1 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 font-medium"
          >
            <span className="max-w-[160px] truncate">{tag}</span>
            <button
              onClick={() => removeTag(tag)}
              className="text-red-500 hover:text-red-600 transition-colors"
              title="删除标签"
            >
              <X size={10} />
            </button>
          </span>
        ))
      ) : (
        <span className="text-2xs text-faint">{t("common.noTags")}</span>
      )}
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-0.5 text-2xs text-faint hover:text-violet-600 px-1.5 py-0.5 rounded-md hover:bg-violet-50 dark:hover:bg-violet-900/20"
      >
        <Plus size={10} /> 新增
      </button>
    </div>
  );
}

// ---- Inline file tree with content disclosure ----
function FileTree({ skillId, entries }: { skillId: string; entries: SkillFileEntry[] }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  const toggleFile = useCallback(async (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
    // load on first expand
    if (!fileContents.has(filePath) && !loadingFiles.has(filePath)) {
      setLoadingFiles((prev) => new Set(prev).add(filePath));
      try {
        const content = await readSkillFileByPath(skillId, filePath);
        setFileContents((prev) => new Map(prev).set(filePath, content));
      } catch {
        setFileContents((prev) => new Map(prev).set(filePath, "（无法读取文件）"));
      } finally {
        setLoadingFiles((prev) => { const n = new Set(prev); n.delete(filePath); return n; });
      }
    }
  }, [skillId, fileContents, loadingFiles]);

  const renderNode = (entry: SkillFileEntry, depth: number): React.ReactNode => {
    const paddingLeft = `${depth * 14 + 6}px`;

    if (entry.is_dir) {
      return <DirNode key={entry.path} entry={entry} depth={depth} renderChildren={renderNode} />;
    }

    const isExpanded = expandedFiles.has(entry.path);
    const isLoading = loadingFiles.has(entry.path);
    const content = fileContents.get(entry.path);
    const isMd = entry.name.endsWith(".md");

    return (
      <div key={entry.path}>
        <button
          onClick={() => toggleFile(entry.path)}
          className={
            "w-full flex items-center gap-1 py-1 pr-2 text-xs transition-colors " +
            (isExpanded ? "text-violet-600 dark:text-violet-300 font-semibold" : "text-muted hover:text-content")
          }
          style={{ paddingLeft }}
        >
          {isExpanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          <FileText size={12} className={"shrink-0 " + (isMd ? "text-violet-400" : "text-faint")} />
          <span className="truncate">{entry.name}</span>
        </button>
        {isExpanded && (
          <div style={{ paddingLeft }}>
            {isLoading ? (
              <div className="flex items-center gap-1.5 py-2 pl-5 text-2xs text-faint">
                <Loader2 size={11} className="animate-spin" /> 加载中...
              </div>
            ) : (
              <pre className="text-2xs font-mono text-muted whitespace-pre-wrap break-words leading-relaxed pl-5 pr-2 py-2 max-h-[300px] overflow-y-auto border-l border-border-subtle ml-1">
                {content}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  return <div>{entries.map((e) => renderNode(e, 0))}</div>;
}

// ---- Directory node (separate component for own expand state) ----
function DirNode({
  entry, depth, renderChildren,
}: {
  entry: SkillFileEntry; depth: number;
  renderChildren: (entry: SkillFileEntry, depth: number) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const paddingLeft = `${depth * 14 + 6}px`;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1 py-1 pr-2 text-xs text-muted hover:text-content transition-colors"
        style={{ paddingLeft }}
      >
        {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        {expanded ? <FolderOpen size={12} className="shrink-0 text-violet-400" /> : <FolderClosed size={12} className="shrink-0 text-faint" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && entry.children.map((child) => renderChildren(child, depth + 1))}
    </div>
  );
}

function ConnectionSummary({ connection }: { connection: SkillConnectionState }) {
  return (
    <div className="flex items-center gap-1.5 pl-6 flex-wrap">
      <span
        className={
          "text-2xs px-1.5 py-0.5 rounded font-medium " +
          (connection.enabled
            ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30"
            : "text-amber-600 bg-amber-50 dark:bg-amber-900/30")
        }
      >
        {connection.enabled ? "Agent 可用" : "Skill 已停用"}
      </span>
      {connection.shared && (
        <span className="text-2xs px-1.5 py-0.5 rounded text-violet-600 bg-violet-50 dark:bg-violet-900/30 font-medium">
          共享连接：{connection.affected_agents.join("、")}
        </span>
      )}
    </div>
  );
}

// ---- Detail panel ----
function SkillDetail() {
  const t = useT();
  const {
    selectedSkillId, skills, agentOptions, skillConnections, skillContent, loadingContent,
    requestSkillDelete, toggleSkillEnabled, skillFiles, librarySources, toggleConnect, adoptRealEntry,
  } = useAppStore();
  const [descExpanded, setDescExpanded] = useState(false);
  const [adoptionAgentId, setAdoptionAgentId] = useState<string | null>(null);
  const [adoptionSourceId, setAdoptionSourceId] = useState("");
  const [homeDirectory, setHomeDirectory] = useState("");

  const skill = skills.find((s) => s.id === selectedSkillId);

  useEffect(() => {
    let active = true;
    getHomeDirectory()
      .then((home) => {
        if (active) setHomeDirectory(home);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!skill) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-faint border-l border-border">
        <Folder size={36} className="opacity-30" />
        <p className="text-xs mt-3">选中一个 skill 查看详情</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border-l border-border bg-surface overflow-hidden">
      {/* header */}
      <div className="px-5 pt-4 pb-3 border-b border-border-subtle shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-heading truncate">{skill.name}</h3>
            </div>
            {/* file path — clickable to reveal in Finder */}
            <button
              onClick={() => revealInFinder(skill.path)}
              className="mt-1 flex items-center gap-1 text-2xs text-faint hover:text-violet-500 transition-colors group max-w-full"
              title="在 Finder 中显示"
            >
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate font-mono">{skill.path}</span>
              <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => toggleSkillEnabled(skill.id, !skill.enabled)}
              className={skill.enabled ? "btn btn-ghost btn-sm text-emerald-500" : "btn btn-outline btn-sm text-faint"}
              title={skill.enabled ? "停用" : "启用"}
            >
              <Power size={13} /> {skill.enabled ? "已启用" : "已停用"}
            </button>
            <button
              onClick={() => requestSkillDelete({ id: skill.id, name: skill.name, path: skill.path })}
              className="btn btn-ghost btn-sm text-red-500"
              title={t("common.delete")}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* description — 3-line clamp, expandable */}
        {skill.description && (
          <div className="px-5 py-3 border-b border-border-subtle">
            <p className={"text-xs text-muted leading-relaxed " + (descExpanded ? "" : "line-clamp-3")}>
              {skill.description}
            </p>
            {skill.description.length > 120 && (
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="flex items-center gap-0.5 mt-1 text-2xs text-violet-500 hover:text-violet-700"
              >
                {descExpanded ? <><ChevronUp size={11} /> 收起</> : <><ChevronDown size={11} /> 展开</>}
              </button>
            )}
          </div>
        )}

        {/* metadata: author / license */}
        {(skill.author || skill.license || skill.version) && (
          <div className="px-5 py-3 border-b border-border-subtle space-y-1.5">
            {skill.author && (
              <div className="flex items-center gap-2 text-xs">
                <User size={12} className="text-faint shrink-0" />
                <span className="text-faint shrink-0">作者</span>
                <span className="text-muted truncate">{skill.author}</span>
              </div>
            )}
            {skill.version && (
              <div className="flex items-center gap-2 text-xs">
                <Layers size={12} className="text-faint shrink-0" />
                <span className="text-faint shrink-0">版本</span>
                <span className="text-muted font-mono truncate">{skill.version}</span>
              </div>
            )}
            {skill.license && (
              <div className="flex items-center gap-2 text-xs">
                <Scale size={12} className="text-faint shrink-0" />
                <span className="text-faint shrink-0">许可证</span>
                <span className="text-muted truncate">{skill.license}</span>
              </div>
            )}
          </div>
        )}

        {/* tags */}
        <div className="px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-1.5 mb-2">
            <TagIcon size={12} className="text-faint" />
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">标签</span>
          </div>
          <TagEditor skillId={skill.id} tags={skill.tags} />
        </div>

        {/* permissions */}
        <div className="px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck size={12} className="text-faint" />
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">权限</span>
          </div>
          {skill.permissions.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {skill.permissions.map((p) => {
                const cfg = PERM_ICONS[p];
                if (!cfg) return null;
                const Icon = cfg.icon;
                return (
                  <span key={p} className="flex items-center gap-1 text-2xs px-2 py-0.5 rounded-md bg-surface-2 font-medium">
                    <Icon size={10} className={cfg.color} /> {cfg.label}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-2xs text-faint">无额外权限需求</span>
          )}
        </div>

        {/* Agent connections */}
        <div className="px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-1.5 mb-2">
            <Link2 size={12} className="text-faint" />
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">接线状态</span>
          </div>
          <div className="space-y-2.5">
            {agentOptions.map((agent) => {
              const connection = skillConnections.find((item) => item.agent_id === agent.id);
              const isReal = connection?.kind === "real_directory" || connection?.kind === "real_file";
              return (
                <div key={agent.id} className="space-y-1.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AgentGlyph
                      id={agent.id}
                      label={agent.label}
                      size={20}
                      active={Boolean(connection)}
                    />
                    <span className={"text-xs font-medium shrink-0 " + (connection ? "text-content" : "text-faint")}>
                      {agent.label}
                    </span>
                    <div className="ml-auto shrink-0">
                      {connection?.kind === "symlink" && (
                        <MiniToggle checked onChange={() => toggleConnect(skill.id, agent.id)} />
                      )}
                    </div>
                    {isReal && (
                      <button
                        onClick={() => {
                          setAdoptionAgentId(adoptionAgentId === agent.id ? null : agent.id);
                          setAdoptionSourceId("");
                        }}
                        className="btn btn-outline btn-sm shrink-0 text-amber-600"
                        title="移动真实入口到库源并留下软链"
                      >
                        <ArchiveRestore size={12} /> 收纳
                      </button>
                    )}
                    {!connection && (
                      <button
                        onClick={() => toggleConnect(skill.id, agent.id)}
                        className="btn btn-outline btn-sm shrink-0"
                      >
                        <Link2 size={12} /> 接入
                      </button>
                    )}
                  </div>
                  {connection ? (
                    <button
                      data-testid="connection-path-button"
                      onClick={() => revealInFinder(connection.entry_path)}
                      className="flex max-w-full items-center gap-1 pl-6 text-2xs text-faint transition-colors hover:text-violet-500"
                      title={`${connection.entry_path} · 在 Finder 中显示`}
                    >
                      <FolderOpen size={11} className="shrink-0" />
                      <span className="min-w-0 truncate font-mono">
                        {formatSkillPath(connection.entry_path, homeDirectory)}
                      </span>
                      <ExternalLink size={10} className="shrink-0 opacity-60" />
                    </button>
                  ) : (
                    <div className="pl-6 text-2xs text-faint">未接线</div>
                  )}
                  {connection?.kind === "symlink" && (
                    <ConnectionSummary connection={connection} />
                  )}
                  {isReal && adoptionAgentId === agent.id && (
                    <div className="flex items-center gap-1.5 pl-6">
                      <select
                        value={adoptionSourceId}
                        onChange={(event) => setAdoptionSourceId(event.target.value)}
                        className="px-2 py-1 text-2xs border border-border rounded-md bg-transparent min-w-[140px]"
                      >
                        <option value="">选择库源</option>
                        {librarySources.filter((source) => source.enabled).map((source) => (
                          <option key={source.id} value={source.id}>{source.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          if (!adoptionSourceId) return;
                          adoptRealEntry(skill.id, agent.id, adoptionSourceId);
                          setAdoptionAgentId(null);
                          setAdoptionSourceId("");
                        }}
                        disabled={!adoptionSourceId}
                        className="btn btn-primary btn-sm"
                      >
                        移动并留软链
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* document list — inline expandable file tree */}
        <div className="px-5 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText size={12} className="text-faint" />
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">文档列表</span>
          </div>
          {skillFiles.length === 0 ? (
            <div className="text-xs text-faint py-2">{loadingContent ? t("common.loading") : "无文件"}</div>
          ) : (
            <div className="bg-page dark:bg-surface-2 rounded-lg border border-border-subtle p-2 max-h-[500px] overflow-y-auto">
              <FileTree skillId={skill.id} entries={skillFiles} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =================== Main View ===================

export default function SkillsView() {
  const [leftDrawerOpen] = useState(() => window.innerWidth >= 1000);
  const t = useT();
  const {
   skills, agentOptions, searchQuery, setSearchQuery,
   librarySources, selectedSkillId, selectSkill, toggleSkillEnabled,
   requestBatchSharedDisconnect,
 } = useAppStore();

  const [railFilter, setRailFilter] = useState<string>(ALL);
  const [multiSelect, setMultiSelect] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const tagClusters = useMemo(() => {
    const map = new Map<string, number>();
    skills.forEach((s) => s.tags.forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1)));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [skills]);

  const libCounts = useMemo(() => {
    const map = new Map<string, number>();
    skills.forEach((s) => map.set(s.source_lib, (map.get(s.source_lib) || 0) + 1));
    return map;
  }, [skills]);

  const filtered = useMemo(() => {
    let result = [...skills];
    if (railFilter.startsWith("tag:")) {
      const tag = railFilter.slice(4);
      result = result.filter((s) => s.tags.includes(tag));
    } else if (railFilter.startsWith("lib:")) {
      const lib = railFilter.slice(4);
      result = result.filter((s) => s.source_lib === lib);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [skills, railFilter, searchQuery]);

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const railLabel = railFilter === ALL ? "全部" : `「${railFilter.slice(4)}」`;

  return (
    <div
      className={
        "skill-layout " +
        (leftDrawerOpen ? "" : "skill-layout--left-closed")
      }
      data-left-open={leftDrawerOpen}
    >
      {/* ===== Left rail ===== */}
      {leftDrawerOpen && (
        <aside data-testid="skills-left-drawer" className="skills-left-drawer">
          <div className="rail-section-label">标签聚类</div>
          <RailItem label="全部" count={skills.length} active={railFilter === ALL} onClick={() => setRailFilter(ALL)} />
          {tagClusters.map(({ tag, count }) => (
            <RailItem key={tag} label={tag} count={count} active={railFilter === `tag:${tag}`} onClick={() => setRailFilter(`tag:${tag}`)} />
          ))}
          <div className="h-px bg-border-subtle my-2.5 mx-1" />
          <div className="rail-section-label">库源</div>
          {librarySources.map((lib) => (
            <RailItem key={lib.id} label={lib.name} count={libCounts.get(lib.name) || 0} active={railFilter === `lib:${lib.name}`} onClick={() => setRailFilter(`lib:${lib.name}`)} />
          ))}
        </aside>
      )}

      {/* ===== Middle column ===== */}
      <div className="flex flex-col min-h-0 min-w-0 overflow-hidden">
        <div className="skills-toolbar">
          <div className="skills-search">
            <Search size={14} className="skills-search-icon" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`筛选${railLabel}聚类下 ${filtered.length} 个 skill`}
              className="input"
            />
          </div>
          <button
            onClick={() => { setMultiSelect(!multiSelect); if (multiSelect) setCheckedIds(new Set()); }}
            className={"btn btn-sm shrink-0 " + (multiSelect ? "btn-primary" : "btn-outline")}
            title="多选模式"
          >
            <CheckSquare size={13} /> <span className="skills-toolbar-label">多选模式</span>
          </button>
          <button onClick={() => useAppStore.getState().setView("presets")} className="btn btn-ghost btn-sm shrink-0" title="应用预设">
            <Layers size={13} /> <span className="skills-toolbar-label">应用预设</span>
          </button>
         <div className="flex-1 min-w-0" />
        </div>

        {/* multi-select batch bar */}
        {multiSelect && (
          <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 dark:bg-violet-900/20 border-b border-border-subtle">
            <span className="text-xs text-violet-600 dark:text-violet-300 font-medium shrink-0">
              已选 {checkedIds.size} 个
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <button onClick={() => setCheckedIds(new Set(filtered.map((s) => s.id)))} className="btn btn-ghost btn-sm">全选</button>
              <button
                onClick={() => setCheckedIds((prev) => {
                  const next = new Set<string>();
                  filtered.forEach((s) => { if (!prev.has(s.id)) next.add(s.id); });
                  return next;
                })}
                className="btn btn-ghost btn-sm"
              >反选</button>
              <div className="w-px h-4 bg-border-subtle" />
              <button
                onClick={async () => {
                  let failed = 0;
                  for (const id of checkedIds) {
                    try {
                      await toggleSkillEnabled(id, true);
                    } catch (e) {
                      failed += 1;
                      console.error(e);
                    }
                  }
                  if (failed > 0) useToastStore.getState().show(`批量启用：${failed} 个失败`, "error");
                }}
                disabled={checkedIds.size === 0}
                className="btn btn-outline btn-sm text-emerald-500"
              >
                <Power size={12} /> 启用
              </button>
              <button
                onClick={async () => {
                  let failed = 0;
                  for (const id of checkedIds) {
                    try {
                      await toggleSkillEnabled(id, false);
                    } catch (e) {
                      failed += 1;
                      console.error(e);
                    }
                  }
                  if (failed > 0) useToastStore.getState().show(`批量停用：${failed} 个失败`, "error");
                }}
                disabled={checkedIds.size === 0}
                className="btn btn-outline btn-sm text-faint"
              >
                <Power size={12} /> 停用
              </button>
              <div className="w-px h-4 bg-border-subtle" />
              <select
                defaultValue=""
                onChange={async (e) => {
                  const agentId = e.target.value;
                  e.target.value = "";
                  if (!agentId) return;
                  const ids = Array.from(checkedIds);
                  try {
                    await batchConnect(ids, [], agentId);
                  } catch (error) {
                    console.error(error);
                    useToastStore.getState().show("批量接入失败", "error");
                  }
                  await useAppStore.getState().loadSkills();
                  await useAppStore.getState().loadActivity();
                }}
                disabled={checkedIds.size === 0}
                className="btn btn-outline btn-sm pr-2"
              >
                <option value="">接入到…</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>接 {agent.label}</option>
                ))}
              </select>
              <select
                data-testid="batch-disconnect-agent"
                defaultValue=""
                onChange={async (e) => {
                  const agentId = e.target.value;
                  e.target.value = "";
                  if (!agentId) return;

                  const disconnectIds = getDisconnectableSkillIds(skills, checkedIds, agentId);
                  if (disconnectIds.length === 0) {
                    useToastStore.getState().show("选中的 Skill 均未连接该 Agent", "error");
                    return;
                  }

                  try {
                    await batchConnect([], disconnectIds, agentId);
                    await useAppStore.getState().loadSkills();
                    const selectedSkillId = useAppStore.getState().selectedSkillId;
                    if (selectedSkillId) {
                      await useAppStore.getState().loadSkillConnections(selectedSkillId);
                    }
                    await useAppStore.getState().loadActivity();
                    useToastStore.getState().show(`已断开 ${disconnectIds.length} 个 Skill`);
                  } catch (error) {
                    const confirmation = buildBatchSharedDisconnectConfirmation(
                      error,
                      disconnectIds,
                      agentId,
                    );
                    if (confirmation) {
                      await useAppStore.getState().loadSkills();
                      const latestSkills = useAppStore.getState().skills;
                      const retryIds = disconnectIds.filter((id) => {
                        const latestSkill = latestSkills.find((skill) => skill.id === id);
                        return latestSkill?.links.includes(agentId);
                      });
                      if (retryIds.length > 0) {
                        requestBatchSharedDisconnect({ ...confirmation, skillIds: retryIds });
                      }
                      return;
                    }
                    console.error(error);
                    useToastStore.getState().show("批量断开失败", "error");
                    await useAppStore.getState().loadSkills();
                    await useAppStore.getState().loadActivity();
                  }
                }}
                disabled={checkedIds.size === 0}
                className="btn btn-outline btn-sm pr-2"
              >
                <option value="">断开自…</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>断 {agent.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* table header */}
        <div className={"skills-table-header skills-table-grid"}>
          <span>名称</span>
          <span className="text-center">智能体</span>
          <span className="text-center">权限</span>
          <span className="text-center">审计</span>
          <span className="text-center">状态</span>
        </div>

        {/* skill table */}
        <div className="flex-1 overflow-y-auto bg-surface">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-faint">
              <Folder size={36} className="opacity-30" />
              <p className="text-sm mt-2">{skills.length === 0 ? t("skills.emptyHint") : t("skills.noMatch")}</p>
            </div>
          ) : (
            filtered.map((skill) => (
              <SkillTableRow
                key={skill.id}
                skill={skill}
                agentOptions={agentOptions}
                selected={selectedSkillId === skill.id}
                multiSelect={multiSelect}
                checked={checkedIds.has(skill.id)}
                onSelect={() => selectSkill(skill.id)}
                onToggleCheck={() => toggleCheck(skill.id)}
              />
            ))
          )}
        </div>
      </div>

    </div>
  );
}

export function SkillsRightDrawer({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <aside data-testid="skills-right-drawer" className="skills-right-drawer">
      <SkillDetail />
    </aside>
  );
}
