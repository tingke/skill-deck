import { useState, useMemo, useCallback, useEffect } from "react";
import { useUiStore } from "../stores/ui";
import { useSkillsStore } from "../stores/skills";
import { useWorkspaceStore } from "../stores/workspace";
import { useActivityStore } from "../stores/activity";
import {
  Search, Folder, X, Check, Trash2,
  Tag as TagIcon, CheckSquare, Layers, Square,
  Power, FileText, Link2, Clock, ShieldCheck,
  FolderOpen, FolderClosed, ChevronRight, ChevronDown,
  FilePen, Cpu, Globe, User, Scale, Settings as SettingsIcon,
  ExternalLink, Loader2, Plus,
  ArchiveRestore,
  Download, TriangleAlert, OctagonX, RefreshCw, ArrowUp, GitBranch,
} from "lucide-react";
import type { Skill, AgentInfo, SkillFileEntry, SkillConnectionState, InstallResult, UpdateAvailability } from "../types";
import { revealInFinder, readSkillFileByPath, batchConnect, getHomeDirectory, checkSkillUpdates, updateSkill } from "../lib/tauri";
import { getDisconnectableSkillIds } from "../lib/skillBatch";
import { formatSkillPath } from "../lib/skillPaths";
import { auditVerdictMeta, scoreGradeMeta, INSTALL_STATUS_META, needsUserConfirm } from "../lib/skillAudit";
import { buildBatchSharedDisconnectConfirmation } from "../lib/connectionConfirmation";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { ContentTitle } from "../components/PageHeader";
import ViewToggle from "../components/ViewToggle";
import { AgentGlyph } from "../components/AgentGlyph";
import AuditFindings from "../components/AuditFindings";
import InstallSkillDialog from "../components/InstallSkillDialog";
import DetailDrawer from "../components/DetailDrawer";

const ALL = "__all__";

// ---- Permission icon mapping ----
const PERM_ICONS: Record<string, { icon: typeof Cpu; label: string; color: string }> = {
  "exec": { icon: Cpu, label: "可执行", color: "text-amber-500" },
  "file:write": { icon: FilePen, label: "可写入", color: "text-blue-500" },
  "network": { icon: Globe, label: "可联网", color: "text-accent" },
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

// ---- Audit verdict badge in table (dot + word, V6) ----
function AuditBadge({ verdict }: { verdict?: string | null }) {
  const t = useT();
  const dot = (color: string) => <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: color }} />;
  if (verdict === "pass") {
    return <span title={t("safety.statPass")} className="inline-flex items-center gap-1.5">{dot("rgb(var(--c-success))")}<span className="text-2xs" style={{ color: "rgb(var(--c-success))" }}>{t("safety.statPass")}</span></span>;
  }
  if (verdict === "warn") {
    return <span title={t("safety.statWarn")} className="inline-flex items-center gap-1.5">{dot("rgb(var(--c-warning))")}<span className="text-2xs" style={{ color: "rgb(var(--c-warning))" }}>{t("safety.statWarn")}</span></span>;
  }
  if (verdict === "block") {
    return <span title={t("safety.statBlock")} className="inline-flex items-center gap-1.5">{dot("rgb(var(--c-danger))")}<span className="text-2xs" style={{ color: "rgb(var(--c-danger))" }}>{t("safety.statBlock")}</span></span>;
  }
  return <span title={t("safety.statPending")} className="inline-flex items-center gap-1.5"><span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: "rgb(var(--c-faint))" }} /><span className="text-2xs text-faint">{t("safety.statPending")}</span></span>;
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
        "list-row list-row--skill relative " +
        (selected ? "list-row--selected" : "") +
        (!skill.enabled ? " opacity-50" : "")
      }
    >
      {multiSelect && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none">
          {checked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} className="text-faint" />}
        </div>
      )}
      <span className={"list-row__name min-w-0 " + (multiSelect ? "pl-5" : "")}>
        {skill.name}
        {!skill.enabled && <Power size={11} className="inline text-faint ml-1" />}
      </span>
      <span className="list-row__desc min-w-0">
        {skill.description || (skill.tags.length > 0 ? skill.tags.join(" · ") : "")}
      </span>
      <span className="list-row__dots">
        {agentOptions.map((agent) => (
          <AgentGlyph
            key={agent.id}
            id={agent.id}
            label={agent.label}
            size={16}
            active={skill.links.includes(agent.id)}
          />
        ))}
      </span>
      <AuditBadge verdict={skill.audit_verdict} />
      <ChevronRight size={14} className="list-row__chev" />
    </div>
  );
}

// ---- Grid card (V6 集合页网格) ----
function SkillCard({
  skill, agentOptions, selected, multiSelect, checked, onSelect, onToggleCheck,
}: {
  skill: Skill; agentOptions: AgentInfo[]; selected: boolean;
  multiSelect: boolean; checked: boolean;
  onSelect: () => void; onToggleCheck: () => void;
}) {
  const t = useT();
  return (
    <div
      onClick={multiSelect ? onToggleCheck : onSelect}
      className={
        "card relative p-3.5 flex flex-col gap-2 cursor-pointer transition-colors " +
        (selected ? "card-selected" : "card-hover") +
        (!skill.enabled ? " opacity-50" : "")
      }
    >
      {multiSelect && (
        <div className="absolute left-2 top-2 pointer-events-none">
          {checked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} className="text-faint" />}
        </div>
      )}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-heading">{skill.name}</span>
        {!skill.enabled && <Power size={11} className="text-faint shrink-0" />}
        <span className="ml-auto shrink-0"><AuditBadge verdict={skill.audit_verdict} /></span>
      </div>
      {skill.description && (
        <p className="text-2xs leading-relaxed text-muted line-clamp-2 min-h-[28px]">{skill.description}</p>
      )}
      <div className="flex items-center gap-1 mt-auto pt-0.5">
        {agentOptions.map((agent) => (
          <AgentGlyph
            key={agent.id}
            id={agent.id}
            label={agent.label}
            size={16}
            active={skill.links.includes(agent.id)}
          />
        ))}
        {skill.tags.length > 0 && (
          <span className="ml-auto text-2xs text-faint truncate max-w-[100px]" title={skill.tags.join(", ")}>
            {skill.tags[0]}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Tag editor ----
function TagEditor({ skillId, tags }: { skillId: string; tags: string[] }) {
  const t = useT();
  const { updateTags } = useSkillsStore();
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
          className="input flex-1 min-w-[140px]"
          autoFocus
        />
        <button onClick={addTag} className="p-1 text-emerald-500 hover:text-emerald-700"><Check size={14} /></button>
        <button
          onClick={() => { setText(""); setAdding(false); }}
          className="btn-icon btn-icon-sm"
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
            className="inline-flex items-center gap-1 text-2xs pl-2 pr-1 py-0.5 rounded-md bg-accent-soft text-accent font-medium"
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
        className="flex items-center gap-0.5 text-2xs text-faint hover:text-accent px-1.5 py-0.5 rounded-md hover:bg-accent-soft"
      >
        <Plus size={10} /> 新增
      </button>
    </div>
  );
}

// ---- Inline file tree with content disclosure ----
// ---- 详情文件树：目录可展开，文件点击选中（内容在下方独立面板显示） ----
function DetailFileTree({
  entries, depth, activePath, onSelect,
}: {
  entries: SkillFileEntry[]; depth: number; activePath?: string;
  onSelect: (entry: SkillFileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const paddingLeft = `${depth * 12 + 6}px`;

  return (
    <div>
      {entries.map((entry) =>
        entry.is_dir ? (
          <div key={entry.path}>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-1 py-1 pr-2 text-xs text-muted hover:text-content transition-colors"
              style={{ paddingLeft }}
            >
              {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
              {expanded ? <FolderOpen size={12} className="shrink-0 text-accent" /> : <FolderClosed size={12} className="shrink-0 text-faint" />}
              <span className="truncate">{entry.name}</span>
            </button>
            {expanded && (
              <DetailFileTree entries={entry.children} depth={depth + 1} activePath={activePath} onSelect={onSelect} />
            )}
          </div>
        ) : (
          <button
            key={entry.path}
            onClick={() => onSelect(entry)}
            title={entry.path}
            className={
              "w-full flex items-center gap-1 py-1 pr-2 text-xs rounded transition-colors " +
              (activePath === entry.path ? "text-accent font-semibold" : "text-muted hover:text-content")
            }
            style={{ paddingLeft }}
          >
            <FileText size={12} className={"shrink-0 " + (entry.name.toUpperCase().endsWith(".MD") ? "text-accent" : "text-faint")} />
            <span className="truncate">{entry.name}</span>
          </button>
        ),
      )}
    </div>
  );
}

function SkillAuditSection({ skill }: { skill: Skill }) {
  const { skillAudit } = useSkillsStore();
  const setView = useUiStore((s) => s.setView);
  const setAuditFocusSkillId = useUiStore((s) => s.setAuditFocusSkillId);
  const meta = skillAudit ? auditVerdictMeta(skillAudit.verdict) : null;
  const grade = skillAudit
    ? scoreGradeMeta(skillAudit.score)
    : scoreGradeMeta(skill.audit_score);

  const openAudit = () => {
    setAuditFocusSkillId(skill.id);
    setView("audit");
  };

  return (
    <div className="px-5 py-3 border-b border-border-subtle">
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldCheck size={12} className="text-faint" />
        <span className="text-2xs font-semibold text-faint uppercase tracking-wider">安全审查</span>
      </div>
      <button
        onClick={openAudit}
        className="w-full flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-left transition-colors hover:border-violet-300 dark:hover:border-violet-700 group"
        title="查看体检详情"
      >
        {meta ? (
          <span className={"text-2xs px-2 py-0.5 rounded-md font-medium " + meta.badge}>
            {meta.label}
          </span>
        ) : (
          <span className="text-2xs px-2 py-0.5 rounded-md bg-surface text-faint">未审查</span>
        )}
        {skillAudit && skillAudit.score != null && (
          <span className="flex items-center gap-1">
            <span className="text-xs font-mono font-semibold text-heading">{skillAudit.score}</span>
            <span className="text-2xs text-faint">分</span>
            {grade && (
              <span className={"text-2xs px-1.5 py-0.5 rounded font-medium " + grade.badge}>
                {grade.label}
              </span>
            )}
          </span>
        )}
        {skillAudit && skillAudit.findings.length > 0 && (
          <span className="text-2xs text-muted">
            {skillAudit.findings.length} 个发现
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5 text-2xs text-faint group-hover:text-violet-500 transition-colors">
          体检详情 <ChevronRight size={11} />
        </span>
      </button>
    </div>
  );
}

// ---- Origin & update section in detail panel ----
function SkillUpdateSection({ skill, agentOptions }: { skill: Skill; agentOptions: AgentInfo[] }) {
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [availability, setAvailability] = useState<UpdateAvailability | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!skill.origin_type) return null;

  const runCheck = async () => {
    setChecking(true);
    setAvailability(null);
    setResult(null);
    setConfirming(false);
    try {
      const list = await checkSkillUpdates([skill.id]);
      const first = list[0] ?? null;
      setAvailability(first);
      if (first?.error) {
        useToastStore.getState().show(first.error, "error");
      } else if (first && !first.has_update) {
        useToastStore.getState().show("已是最新版本");
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show("检查更新失败", "error");
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async (overrideAudit: boolean, allowLocalChanges: boolean) => {
    setUpdating(true);
    try {
      const updateResult = await updateSkill(skill.id, overrideAudit, allowLocalChanges);
      setResult(updateResult);
      if (updateResult.status === "updated") {
        useToastStore.getState().show(`已更新 ${updateResult.skill_name}`);
        await useSkillsStore.getState().loadSkills();
        await useSkillsStore.getState().loadSkillAudit(skill.id);
        setAvailability(null);
        setConfirming(false);
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(
        error instanceof Error ? error.message : "更新失败",
        "error",
      );
    } finally {
      setUpdating(false);
    }
  };

  const affectedLabels = skill.links
    .map((agentId) => agentOptions.find((agent) => agent.id === agentId)?.label ?? agentId);

  return (
    <div className="px-5 py-3 border-b border-border-subtle">
      <div className="flex items-center gap-1.5 mb-2">
        <GitBranch size={12} className="text-faint" />
        <span className="text-2xs font-semibold text-faint uppercase tracking-wider">来源与更新</span>
        <button
          onClick={runCheck}
          disabled={checking || updating}
          className="ml-auto flex items-center gap-1 text-2xs text-faint hover:text-accent transition-colors"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} 检查更新
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="text-faint shrink-0">来源</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted font-medium shrink-0">
            {skill.origin_type === "git" ? "Git" : skill.origin_type === "archive" ? "Zip" : "本地目录"}
          </span>
          <span className="text-2xs text-faint font-mono truncate min-w-0" title={skill.origin_ref ?? ""}>
            {skill.origin_ref}
          </span>
        </div>

        {availability?.has_update && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            disabled={updating}
            className="btn btn-outline btn-sm"
          >
            <ArrowUp size={12} /> 更新
          </button>
        )}

        {availability?.has_update && confirming && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <div className="text-2xs text-muted leading-relaxed">
              更新会替换库源中的内容；所有已连接的 Agent 通过 symlink 自动使用新版本。
              {availability.local_changes && (
                <span className="text-amber-600 dark:text-amber-400"> 检测到本地改动，更新后将丢失。</span>
              )}
            </div>
            {affectedLabels.length > 0 && (
              <div className="text-2xs text-faint">受影响 Agent：{affectedLabels.join("、")}</div>
            )}
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={updating}>
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => runUpdate(false, availability.local_changes)}
                disabled={updating}
              >
                {updating ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />} 确认更新
              </button>
            </div>
          </div>
        )}

        {result && needsUserConfirm(result.status) && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <div className="text-2xs font-medium text-heading">
              {INSTALL_STATUS_META[result.status]?.label ?? result.status}
            </div>
            <div className="text-2xs text-muted">{result.message}</div>
            {result.report && result.report.findings.length > 0 && (
              <AuditFindings findings={result.report.findings} />
            )}
            <button
              className="btn btn-danger btn-sm"
              onClick={() =>
                runUpdate(
                  result.status !== "local_changes",
                  availability?.local_changes || result.status === "local_changes",
                )
              }
              disabled={updating}
            >
              {updating ? <Loader2 size={12} className="animate-spin" /> : <TriangleAlert size={12} />}
              {result.status === "local_changes" ? "覆盖本地改动并更新" : "我已了解风险，仍要更新"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Detail panel ----
function SkillDetail() {
  const t = useT();
  const {
    selectedSkillId, skills, agentOptions, skillConnections,
    skillFiles, toggleConnect, adoptRealEntry,
  } = useSkillsStore();
  const librarySources = useWorkspaceStore((s) => s.librarySources);
  const [adoptionAgentId, setAdoptionAgentId] = useState<string | null>(null);
  const [adoptionSourceId, setAdoptionSourceId] = useState("");
  const [homeDirectory, setHomeDirectory] = useState("");
  const [tab, setTab] = useState<"files" | "settings">("files");
  const [openFile, setOpenFile] = useState<SkillFileEntry | null>(null);
  const [openContent, setOpenContent] = useState("");
  const [openLoading, setOpenLoading] = useState(false);

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

  const flatFiles = useMemo(() => {
    const out: SkillFileEntry[] = [];
    const walk = (entries: SkillFileEntry[]) =>
      entries.forEach((entry) => {
        if (entry.is_dir) walk(entry.children);
        else out.push(entry);
      });
    walk(skillFiles);
    return out;
  }, [skillFiles]);

  const selectFile = async (entry: SkillFileEntry) => {
    setOpenFile(entry);
    setOpenLoading(true);
    try {
      setOpenContent(await readSkillFileByPath(skill!.id, entry.path));
    } catch {
      setOpenContent("（无法读取文件）");
    } finally {
      setOpenLoading(false);
    }
  };

  // 切换技能时重置文件选择；文件列表就绪后默认选中 SKILL.md（无则第一个文件）
  useEffect(() => {
    setOpenFile(null);
    setOpenContent("");
  }, [skill?.id]);

  useEffect(() => {
    if (openFile || flatFiles.length === 0) return;
    const preferred =
      flatFiles.find((entry) => entry.name.toUpperCase() === "SKILL.MD") ?? flatFiles[0];
    selectFile(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatFiles]);

  if (!skill) {
    return null;
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className={tab === "files" ? "flex-1 min-h-0" : "flex-1 overflow-y-auto"}>
        {tab === "files" ? (
          <div className="h-full flex flex-col px-4 py-2">
            <div className="flex items-center gap-1.5 mb-2 shrink-0">
              <FolderClosed size={12} className="text-faint" />
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider">文件列表</span>
            </div>
            {flatFiles.length === 0 ? (
              <div className="text-xs text-faint py-2">无文件</div>
            ) : (
              <div className="rounded-lg border border-border-subtle p-1.5 overflow-y-auto max-h-[20%] shrink-0">
                <DetailFileTree
                  entries={skillFiles}
                  depth={0}
                  activePath={openFile?.path}
                  onSelect={selectFile}
                />
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-2 mt-3 shrink-0 min-w-0">
              <FilePen size={12} className="text-faint shrink-0" />
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider shrink-0">文件内容</span>
              {openFile && <span className="text-2xs text-faint font-mono truncate">{openFile.path}</span>}
            </div>
            {openLoading ? (
              <div className="flex items-center gap-1.5 py-3 text-2xs text-faint">
                <Loader2 size={11} className="animate-spin" /> 加载中...
              </div>
            ) : openFile ? (
              <pre className="flex-1 min-h-0 text-2xs font-mono text-muted whitespace-pre-wrap break-words leading-relaxed rounded-lg border border-border-subtle bg-surface-2 p-3 overflow-y-auto">
                {openContent}
              </pre>
            ) : (
              <div className="text-xs text-faint py-2">在上方选择一个文件查看内容</div>
            )}
          </div>
        ) : (
          <>
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

        {/* Agent connections — V1 图1: 字母圆点 + 名称 + 路径 + 开关 */}
        <div className="px-5 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Link2 size={12} className="text-faint" />
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">
              接线 {skill.links.length}/{agentOptions.length}
            </span>
          </div>
          <div>
            {agentOptions.map((agent, idx) => {
              const connection = skillConnections.find((item) => item.agent_id === agent.id);
              const isReal = connection?.kind === "real_directory" || connection?.kind === "real_file";
              const linked = Boolean(connection);
              return (
                <div
                  key={agent.id}
                  className={
                    "py-2" + (idx < agentOptions.length - 1 ? " border-b border-border-subtle" : "")
                  }
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      title={agent.label}
                      className="inline-grid place-items-center w-[22px] h-[22px] rounded-full font-mono text-[10px] font-bold shrink-0"
                      style={
                        linked
                          ? { background: "rgb(var(--c-heading))", color: "rgb(var(--c-bg-page))" }
                          : { border: "1px solid rgb(var(--c-border-strong))", color: "rgb(var(--c-muted))" }
                      }
                    >
                      {agent.label.charAt(0).toUpperCase()}
                    </span>
                    <span className={"text-xs font-medium shrink-0 " + (linked ? "text-content" : "text-faint")}>
                      {agent.label}
                    </span>
                    {connection && (
                      <button
                        data-testid="connection-path-button"
                        onClick={() => revealInFinder(connection.entry_path)}
                        className="ml-auto min-w-0 flex items-center gap-1 text-2xs text-faint font-mono transition-colors hover:text-accent"
                        title={`${connection.entry_path} · 在 Finder 中显示`}
                      >
                        <span className="min-w-0 truncate">
                          {formatSkillPath(connection.entry_path, homeDirectory)}
                        </span>
                      </button>
                    )}
                    <div className={"shrink-0 flex items-center gap-1.5 " + (connection ? "" : "ml-auto")} onClick={(e) => e.stopPropagation()}>
                      {isReal && (
                        <button
                          onClick={() => {
                            setAdoptionAgentId(adoptionAgentId === agent.id ? null : agent.id);
                            setAdoptionSourceId("");
                          }}
                          className="btn btn-outline btn-sm text-amber-600"
                          title="移动真实入口到库源并留下软链"
                        >
                          <ArchiveRestore size={12} />
                        </button>
                      )}
                      <MiniToggle
                        checked={linked}
                        onChange={() => toggleConnect(skill.id, agent.id)}
                      />
                    </div>
                  </div>
                  {isReal && adoptionAgentId === agent.id && (
                    <div className="flex items-center gap-1.5 pl-[30px] mt-1.5">
                      <select
                        value={adoptionSourceId}
                        onChange={(event) => setAdoptionSourceId(event.target.value)}
                        className="input w-auto min-w-[140px]"
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

        {/* audit */}
        <SkillAuditSection skill={skill} />

        {/* origin & updates */}
        <SkillUpdateSection skill={skill} agentOptions={agentOptions} />


          </>
        )}
      </div>

      {/* tab 切换（底部浮动胶囊） */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface p-1 shadow-lg">
          {(["files", "settings"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-label={key === "files" ? "文件" : "设置"}
              title={key === "files" ? "文件" : "设置"}
              className={
                "inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors " +
                (tab === key ? "bg-heading text-page" : "text-muted hover:bg-surface-hover")
              }
            >
              {key === "files" ? <FileText size={14} /> : <SettingsIcon size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =================== Main View ===================

export default function SkillsView() {
  const t = useT();
  const [homeDirectory, setHomeDirectory] = useState("");
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
  const {
   skills, agentOptions, selectedSkillId, selectSkill, toggleSkillEnabled,
   requestSkillDelete, requestBatchSharedDisconnect,
 } = useSkillsStore();
 const { searchQuery, setSearchQuery } = useUiStore();
 const librarySources = useWorkspaceStore((s) => s.librarySources);
 const selectedSkill = selectedSkillId ? skills.find((s) => s.id === selectedSkillId) ?? null : null;

  const [railFilter, setRailFilter] = useState<string>(ALL);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [multiSelect, setMultiSelect] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [installOpen, setInstallOpen] = useState(false);
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
    <div className="flex-1 flex flex-col overflow-hidden">
        <div className="skills-toolbar">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <div className="skills-search">
            <Search size={14} className="skills-search-icon" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`筛选 ${filtered.length} 个技能`}
              className="input"
            />
          </div>
          <select
            value={railFilter}
            onChange={(e) => setRailFilter(e.target.value)}
            className="input w-[150px] shrink-0"
            title="按标签或库源筛选"
            aria-label="按标签或库源筛选"
          >
            <option value={ALL}>全部 ({skills.length})</option>
            {tagClusters.length > 0 && (
              <optgroup label="标签聚类">
                {tagClusters.map(({ tag, count }) => (
                  <option key={tag} value={`tag:${tag}`}>{tag} ({count})</option>
                ))}
              </optgroup>
            )}
            {librarySources.length > 0 && (
              <optgroup label="库源">
                {librarySources.map((lib) => (
                  <option key={lib.id} value={`lib:${lib.name}`}>{lib.name} ({libCounts.get(lib.name) || 0})</option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="flex-1 min-w-0" />
          <button
            onClick={() => { setMultiSelect(!multiSelect); if (multiSelect) setCheckedIds(new Set()); }}
            className={"btn btn-sm shrink-0 " + (multiSelect ? "btn-primary" : "btn-outline")}
            title="多选模式"
          >
            <CheckSquare size={13} /> <span className="skills-toolbar-label">多选模式</span>
          </button>
          <button
            onClick={() => setInstallOpen(true)}
            className="btn btn-primary btn-sm shrink-0"
            title="从 Git 仓库 / Zip / 本地目录安装 Skill"
          >
            <Download size={13} /> <span className="skills-toolbar-label">安装</span>
          </button>
        </div>

        {/* multi-select batch bar */}
        {multiSelect && (
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-soft border-b border-border-subtle">
            <span className="text-xs text-accent font-medium shrink-0 tnum">
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
                  await useSkillsStore.getState().loadSkills();
                  await useActivityStore.getState().loadActivity();
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
                    await useSkillsStore.getState().loadSkills();
                    const selectedSkillId = useSkillsStore.getState().selectedSkillId;
                    if (selectedSkillId) {
                      await useSkillsStore.getState().loadSkillConnections(selectedSkillId);
                    }
                    await useActivityStore.getState().loadActivity();
                    useToastStore.getState().show(`已断开 ${disconnectIds.length} 个 Skill`);
                  } catch (error) {
                    const confirmation = buildBatchSharedDisconnectConfirmation(
                      error,
                      disconnectIds,
                      agentId,
                    );
                    if (confirmation) {
                      await useSkillsStore.getState().loadSkills();
                      const latestSkills = useSkillsStore.getState().skills;
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
                    await useSkillsStore.getState().loadSkills();
                    await useActivityStore.getState().loadActivity();
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

        <ContentTitle
          title={t("skills.title")}
          meta={t("skills.meta", {
            skills: skills.length,
            links: skills.reduce((n, s) => n + s.links.length, 0),
            unchecked: skills.filter((s) => !s.audit_verdict).length,
          })}
        />

        {/* skill list / grid */}
        <div className={"flex-1 overflow-y-auto " + (viewMode === "list" ? "" : "px-6 pb-6 pt-1")}>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Folder size={22} strokeWidth={1.5} />
              </div>
              <p className="empty-state__title">
                {skills.length === 0 ? t("skills.emptyHint") : t("skills.noMatch")}
              </p>
              {skills.length === 0 ? (
                <p className="empty-state__hint">支持 Git 仓库、Zip 压缩包、本地目录三种安装来源</p>
              ) : (
                <p className="empty-state__hint">换个关键词或清除筛选条件试试</p>
              )}
            </div>
          ) : viewMode === "list" ? (
            <div className="list-panel mx-6 mb-6">
              {filtered.map((skill) => (
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
              ))}
            </div>
          ) : (
            <div className="card-grid">
              {filtered.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  agentOptions={agentOptions}
                  selected={selectedSkillId === skill.id}
                  multiSelect={multiSelect}
                  checked={checkedIds.has(skill.id)}
                  onSelect={() => selectSkill(skill.id)}
                  onToggleCheck={() => toggleCheck(skill.id)}
                />
              ))}
            </div>
          )}
        </div>

      {/* ===== Skill detail drawer (shared overlay) ===== */}
      <DetailDrawer
        open={!!selectedSkill}
        onClose={() => selectSkill(null)}
        testId="skill-detail-drawer"
        icon={<FolderOpen size={18} className="text-faint shrink-0" />}
        title={selectedSkill?.name ?? ""}
        subtitle={
          selectedSkill && (
            <button
              onClick={() => revealInFinder(selectedSkill.path)}
              className="flex items-center gap-1 max-w-full hover:text-accent transition-colors group"
              title="在 Finder 中显示"
            >
              <span className="truncate">{formatSkillPath(selectedSkill.path, homeDirectory)}</span>
              <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
            </button>
          )
        }
        headerActions={
          selectedSkill && (
            <>
              <button
                onClick={() => toggleSkillEnabled(selectedSkill.id, !selectedSkill.enabled)}
                className={
                  "btn-icon rounded-full bg-surface-2 " +
                  (selectedSkill.enabled ? "text-accent" : "text-faint")
                }
                title={selectedSkill.enabled ? "停用" : "启用"}
                aria-label={selectedSkill.enabled ? "停用" : "启用"}
              >
                <Power size={14} />
              </button>
              <button
                onClick={() =>
                  requestSkillDelete({
                    id: selectedSkill.id,
                    name: selectedSkill.name,
                    path: selectedSkill.path,
                  })
                }
                className="btn-icon rounded-full bg-surface-2 text-red-500 hover:text-red-600"
                title={t("common.delete")}
                aria-label={t("common.delete")}
              >
                <Trash2 size={14} />
              </button>
            </>
          )
        }
      >
        <SkillDetail />
      </DetailDrawer>

      <InstallSkillDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        librarySources={librarySources}
      />

    </div>
  );
}
