import { useState, useMemo, useCallback, useEffect } from "react";
import { useUiStore } from "../stores/ui";
import { useSkillsStore } from "../stores/skills";
import { useWorkspaceStore } from "../stores/workspace";
import {
  Search, Folder, Check, Trash2,
  CheckSquare, Square, Power,
  FolderOpen, ChevronRight,
  Cpu, FilePen, Globe,
  ExternalLink, RefreshCw, ArrowUp,
  Download,
} from "lucide-react";
import type { Skill, AgentInfo } from "../types";
import { revealInFinder, batchConnect, batchToggleSkillEnabled, checkSkillUpdates, getHomeDirectory } from "../lib/tauri";
import { getDisconnectableSkillIds } from "../lib/skillBatch";
import { formatSkillPath } from "../lib/skillPaths";
import { buildBatchSharedDisconnectConfirmation } from "../lib/connectionConfirmation";
import { useToastStore } from "../stores/toast";
import { useActivityStore } from "../stores/activity";
import { useT } from "../i18n";
import { ContentTitle } from "../components/PageHeader";
import { useViewMode } from "../lib/useViewMode";
import ViewToggle from "../components/ViewToggle";
import { AgentGlyph } from "../components/AgentGlyph";
import DetailDrawer from "../components/DetailDrawer";
import BatchDeleteDialog from "../components/skills/BatchDeleteDialog";
import { SkillDetail } from "../components/skills/SkillDetail";
import SkillInstallDialog from "../components/skills/SkillInstallDialog";

const ALL = "__all__";

// ---- Permission icon mapping ----
const PERM_ICONS: Record<string, { icon: typeof Cpu; label: string; color: string }> = {
  "exec": { icon: Cpu, label: "可执行", color: "text-amber-500" },
  "file:write": { icon: FilePen, label: "可写入", color: "text-blue-500" },
  "network": { icon: Globe, label: "可联网", color: "text-accent" },
};

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
  skill, agentOptions, selected, checked, updatable, onSelect, onToggleCheck,
}: {
  skill: Skill; agentOptions: AgentInfo[]; selected: boolean;
  checked: boolean; updatable: boolean;
  onSelect: () => void; onToggleCheck: () => void;
}) {
  const t = useT();
  return (
    <div
      onClick={onSelect}
      className={
        "list-row list-row--skill relative " +
        (selected ? "list-row--selected" : "") +
        (!skill.enabled ? " opacity-50" : "")
      }
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleCheck(); }}
        className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 text-faint hover:text-accent transition-colors"
        title={t("skills.detail.multiSelect")}
        aria-label={checked ? t("skills.detail.invertSelect") : t("skills.detail.selectAll")}
      >
        {checked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} className="opacity-40" />}
      </button>
      <span className={"list-row__name min-w-0 pl-5"}>
        {skill.name}
        {!skill.enabled && <Power size={11} className="inline text-faint ml-1" />}
      </span>
      <span className="list-row__desc min-w-0">
        {skill.description}
      </span>
      <span className="list-row__tags">
        {skill.tags.length > 0 ? (
          <>
            <span className="text-2xs px-1.5 py-0.5 rounded-md bg-accent-soft text-accent font-medium max-w-[140px] truncate">
              {skill.tags[0]}
            </span>
            {skill.tags.length > 1 && (
              <span className="text-2xs text-faint tnum">+{skill.tags.length - 1}</span>
            )}
          </>
        ) : (
          <span className="text-2xs text-faint opacity-0 select-none">—</span>
        )}
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
      {updatable && (
        <span title={t("skills.detail.updateBtn")} className="text-accent shrink-0">
          <ArrowUp size={13} />
        </span>
      )}
      <ChevronRight size={14} className="list-row__chev" />
    </div>
  );
}

// ---- Grid card (V6 集合页网格) ----
function SkillCard({
  skill, agentOptions, selected, checked, updatable, onSelect, onToggleCheck,
}: {
  skill: Skill; agentOptions: AgentInfo[]; selected: boolean;
  checked: boolean; updatable: boolean;
  onSelect: () => void; onToggleCheck: () => void;
}) {
  const t = useT();
  return (
    <div
      onClick={onSelect}
      className={
        "card relative p-3.5 flex flex-col gap-2 cursor-pointer transition-colors " +
        (selected ? "card-selected" : "card-hover") +
        (!skill.enabled ? " opacity-50" : "")
      }
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleCheck(); }}
        className="absolute left-2 top-2 z-10 text-faint hover:text-accent transition-colors"
        title={t("skills.detail.multiSelect")}
        aria-label={checked ? t("skills.detail.invertSelect") : t("skills.detail.selectAll")}
      >
        {checked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} className="opacity-40" />}
      </button>
      <div className="flex items-center gap-1.5 min-w-0 pl-5">
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-heading">{skill.name}</span>
        {!skill.enabled && <Power size={11} className="text-faint shrink-0" />}
        {updatable && (
          <span title={t("skills.detail.updateBtn")} className="shrink-0 text-accent">
            <ArrowUp size={12} />
          </span>
        )}
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
   requestSkillDelete, requestBatchSharedDisconnect, requestBatchDelete,
 } = useSkillsStore();
 const { searchQuery, setSearchQuery } = useUiStore();
 const librarySources = useWorkspaceStore((s) => s.librarySources);
 const selectedSkill = selectedSkillId ? skills.find((s) => s.id === selectedSkillId) ?? null : null;

  const [railFilter, setRailFilter] = useState<string>(ALL);
  const [viewMode, setViewMode] = useViewMode("skills");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatableIds, setUpdatableIds] = useState<Set<string>>(new Set());
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

  // 过滤掉已被删除/扫描移除的 skill，避免批量操作打到不存在的 id
  const validCheckedIds = useMemo(
    () => new Set(Array.from(checkedIds).filter((id) => skills.some((s) => s.id === id))),
    [checkedIds, skills],
  );

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const batchToggleEnabled = async (enabled: boolean) => {
    const ids = Array.from(validCheckedIds);
    if (ids.length === 0) return;
    try {
      const failed = await batchToggleSkillEnabled(ids, enabled);
      await useSkillsStore.getState().loadSkills();
      if (failed.length > 0) {
        useToastStore.getState().show(
          t(enabled ? "skills.detail.batchEnableFailed" : "skills.detail.batchDisableFailed", { count: failed.length }),
          "error",
        );
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(
        t(enabled ? "skills.detail.batchEnableFailed" : "skills.detail.batchDisableFailed", { count: ids.length }),
        "error",
      );
    }
  };

  const railLabel = railFilter === ALL ? "全部" : `「${railFilter.slice(4)}」`;

  const checkAllUpdates = async () => {
    const ids = skills.filter((s) => s.origin_type).map((s) => s.id);
    if (ids.length === 0) return;
    setCheckingUpdates(true);
    try {
      const list = await checkSkillUpdates(ids);
      setUpdatableIds(new Set(list.filter((item) => item.has_update && !item.error).map((item) => item.skill_id)));
      const count = list.filter((item) => item.has_update && !item.error).length;
      useToastStore.getState().show(t("skills.detail.checkUpdatesAllDone", { count }));
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(t("skills.detail.checkUpdatesAllFailed"), "error");
    } finally {
      setCheckingUpdates(false);
    }
  };

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
        <div className="skills-toolbar">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <div className="skills-search">
            <Search size={14} className="skills-search-icon" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("skills.detail.filterPlaceholder", { count: filtered.length })}
              className="input"
            />
          </div>
          <select
            value={railFilter}
            onChange={(e) => setRailFilter(e.target.value)}
            className="input w-[150px] shrink-0"
            title={t("skills.detail.filterTitle")}
            aria-label={t("skills.detail.filterTitle")}
          >
            <option value={ALL}>{t("skills.detail.filterAll", { count: skills.length })}</option>
            {tagClusters.length > 0 && (
              <optgroup label={t("skills.detail.tagGroup")}>
                {tagClusters.map(({ tag, count }) => (
                  <option key={tag} value={`tag:${tag}`}>{tag} ({count})</option>
                ))}
              </optgroup>
            )}
            {librarySources.length > 0 && (
              <optgroup label={t("skills.detail.libGroup")}>
                {librarySources.map((lib) => (
                  <option key={lib.id} value={`lib:${lib.name}`}>{lib.name} ({libCounts.get(lib.name) || 0})</option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="flex-1 min-w-0" />
          {skills.some((s) => s.origin_type) && (            <button
              onClick={checkAllUpdates}
              disabled={checkingUpdates}
              className="btn btn-outline btn-sm shrink-0"
              title={t("skills.detail.checkUpdatesAll")}
            >
              <RefreshCw size={13} className={checkingUpdates ? "animate-spin" : ""} />
              <span className="skills-toolbar-label">{t("skills.detail.checkUpdatesAll")}</span>
              {updatableIds.size > 0 && (
                <span className="text-2xs font-semibold text-accent tnum">{updatableIds.size}</span>
              )}
            </button>
          )}
          <button
            onClick={() => setInstallOpen(true)}
            className="btn btn-primary btn-sm shrink-0"
            title={t("skills.detail.installTooltip")}
          >
            <Download size={13} /> <span className="skills-toolbar-label">{t("skills.detail.install")}</span>
          </button>
        </div>

        {/* floating batch action bar: appears when 1+ skills are checked */}
        {validCheckedIds.size > 0 && (
          <div className="batch-bar">
            <span className="text-xs text-accent font-medium shrink-0 tnum">
              {t("skills.detail.selected", { count: validCheckedIds.size })}
            </span>
            <div className="w-px h-4 bg-border-subtle" />
            <div className="flex items-center gap-1.5">
              {filtered.every((s) => validCheckedIds.has(s.id)) ? (
                <button onClick={() => setCheckedIds(new Set())} className="btn btn-ghost btn-sm">{t("skills.batchDelete.cancelSelect")}</button>
              ) : (
                <button onClick={() => setCheckedIds(new Set(filtered.map((s) => s.id)))} className="btn btn-ghost btn-sm">{t("skills.detail.selectAll")}</button>
              )}
              <button
                onClick={() => setCheckedIds((prev) => {
                  const next = new Set<string>();
                  filtered.forEach((s) => { if (!prev.has(s.id)) next.add(s.id); });
                  return next;
                })}
                className="btn btn-ghost btn-sm"
              >{t("skills.detail.invertSelect")}</button>
              <div className="w-px h-4 bg-border-subtle" />
              <button
                onClick={() => batchToggleEnabled(true)}
                className="btn btn-outline btn-sm text-emerald-500"
              >
                <Power size={12} /> {t("skills.detail.batchEnable")}
              </button>
              <button
                onClick={() => batchToggleEnabled(false)}
                className="btn btn-outline btn-sm text-faint"
              >
                <Power size={12} /> {t("skills.detail.batchDisable")}
              </button>
              <div className="w-px h-4 bg-border-subtle" />
              <select
                defaultValue=""
                onChange={async (e) => {
                  const agentId = e.target.value;
                  e.target.value = "";
                  if (!agentId) return;
                  const ids = Array.from(validCheckedIds);
                  try {
                    await batchConnect(ids, [], agentId);
                  } catch (error) {
                    console.error(error);
                    useToastStore.getState().show(t("skills.detail.batchConnectFailed"), "error");
                  }
                  await useSkillsStore.getState().refreshAfterConnectionOp();
                }}
                className="btn btn-outline btn-sm pr-2"
              >
                <option value="">{t("skills.detail.connectTo")}</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>{t("skills.detail.connectPrefix", { label: agent.label })}</option>
                ))}
              </select>
              <select
                data-testid="batch-disconnect-agent"
                defaultValue=""
                onChange={async (e) => {
                  const agentId = e.target.value;
                  e.target.value = "";
                  if (!agentId) return;

                  const disconnectIds = getDisconnectableSkillIds(skills, validCheckedIds, agentId);
                  if (disconnectIds.length === 0) {
                    useToastStore.getState().show(t("skills.detail.batchNotConnected"), "error");
                    return;
                  }

                  try {
                    await batchConnect([], disconnectIds, agentId);
                    await useSkillsStore.getState().refreshAfterConnectionOp();
                    useToastStore.getState().show(t("skills.detail.batchDisconnected", { count: disconnectIds.length }));
                  } catch (error) {
                    const confirmation = buildBatchSharedDisconnectConfirmation(
                      error,
                      disconnectIds,
                      agentId,
                    );
                    if (confirmation) {
                      await useSkillsStore.getState().refreshAfterConnectionOp();
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
                    useToastStore.getState().show(t("skills.detail.batchDisconnectFailed"), "error");
                    await useSkillsStore.getState().refreshAfterConnectionOp();
                  }
                }}
                className="btn btn-outline btn-sm pr-2"
              >
                <option value="">{t("skills.detail.disconnectFrom")}</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>{t("skills.detail.disconnectPrefix", { label: agent.label })}</option>
                ))}
              </select>
              <div className="w-px h-4 bg-border-subtle" />
              <button
                onClick={() => requestBatchDelete(Array.from(validCheckedIds))}
                className="btn btn-outline btn-sm text-red-500 hover:text-red-600"
              >
                <Trash2 size={12} /> {t("skills.batchDelete.action")}
              </button>
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
                <p className="empty-state__hint">{t("skills.detail.installSourcesHint")}</p>
              ) : (
                <p className="empty-state__hint">{t("skills.detail.searchTagOrLib")}</p>
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
                  checked={validCheckedIds.has(skill.id)}
                  updatable={updatableIds.has(skill.id)}
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
                  checked={validCheckedIds.has(skill.id)}
                  updatable={updatableIds.has(skill.id)}
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
              title={t("skills.detail.showInFinder")}
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
                title={selectedSkill.enabled ? t("skills.detail.batchDisable") : t("skills.detail.batchEnable")}
                aria-label={selectedSkill.enabled ? t("skills.detail.batchDisable") : t("skills.detail.batchEnable")}
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

      <BatchDeleteDialog />

      {/* 自定义安装（Git / Zip / 本地目录，自动识别来源类型） */}
      <SkillInstallDialog
        target={installOpen ? { mode: "custom" } : null}
        libraries={librarySources.filter((lib) => lib.enabled)}
        skills={skills}
        onClose={() => setInstallOpen(false)}
        onInstalled={async () => {
          await useSkillsStore.getState().loadSkills();
          await useActivityStore.getState().loadActivity();
        }}
      />

    </div>
  );
}
