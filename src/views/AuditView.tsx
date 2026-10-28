import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  Info,
  Loader2,
  Lock,
  OctagonX,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { useSkillsStore } from "../stores/skills";
import { useActivityStore } from "../stores/activity";
import { useUiStore } from "../stores/ui";
import { useToastStore } from "../stores/toast";
import PageHeader from "../components/PageHeader";
import { useT } from "../i18n";
import type { AuditReport, Skill, SkillAuditSummary } from "../types";
import { auditSkillsBatch, disconnectSkill, getSkillAudit, scanAll } from "../lib/tauri";
import { parseSharedDisconnectError } from "../lib/connectionConfirmation";
import {
  auditRiskRank,
  auditStats,
  groupFindings,
  mergeFindings,
  ruleExplanation,
} from "../lib/skillAudit";
import { formatAuditTime } from "../lib/auditTime";
import DetailDrawer from "../components/DetailDrawer";
import SearchInput from "../components/SearchInput";
import AuditRulesDialog from "../components/AuditRulesDialog";
import ConnectionConfirmationDialog from "../components/ConnectionConfirmationDialog";
import SkillDeleteDialog from "../components/SkillDeleteDialog";

const toast = () => useToastStore.getState();

type SafetyFilter = "all" | "pass" | "warn" | "block" | "pending";

export default function AuditView() {
  const t = useT();
  const skills = useSkillsStore((s) => s.skills);
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const loadActivity = useActivityStore((s) => s.loadActivity);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SafetyFilter>("all");
  const [auditing, setAuditing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SkillAuditSummary>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<AuditReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});
  const auditFocusSkillId = useUiStore((s) => s.auditFocusSkillId);
  const setAuditFocusSkillId = useUiStore((s) => s.setAuditFocusSkillId);

  const stats = useMemo(() => auditStats(skills), [skills]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (filter !== "all" && skill.audit_verdict !== filter) return false;
        if (!keyword) return true;
        return (
          skill.name.toLowerCase().includes(keyword) ||
          skill.source_lib.toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => {
        const rank = auditRiskRank(a.audit_verdict) - auditRiskRank(b.audit_verdict);
        return rank !== 0 ? rank : a.name.localeCompare(b.name);
      });
  }, [skills, query, filter]);

  const applySummaries = (list: SkillAuditSummary[]) => {
    setSummaries((prev) => {
      const next = { ...prev };
      for (const summary of list) next[summary.skill_id] = summary;
      return next;
    });
  };

  const runBatch = async (ids: string[] | null) => {
    if (auditing) return;
    setAuditing(true);
    try {
      const list = await auditSkillsBatch(ids);
      applySummaries(list);
      await useSkillsStore.getState().loadSkills();
      const blocked = list.filter((s) => s.verdict === "block").length;
      const warned = list.filter((s) => s.verdict === "warn").length;
      toast().show(
        t("safety.batchDone", { count: list.length }) +
          (blocked ? t("safety.batchBlocked", { count: blocked }) : "") +
          (warned ? t("safety.batchWarned", { count: warned }) : ""),
        blocked > 0 ? "error" : "success",
      );
    } catch (error) {
      console.error(error);
      toast().show(t("safety.batchFailed"), "error");
    } finally {
      setAuditing(false);
    }
  };

  /** 空态主行动：扫描本地技能库并立刻做首轮体检 */
  const scanAndCheck = async () => {
    if (auditing) return;
    setAuditing(true);
    try {
      const scanned = await scanAll(true);
      useSkillsStore.setState({ skills: scanned });
      const list = await auditSkillsBatch(null);
      applySummaries(list);
      await loadSkills();
      const blocked = list.filter((s) => s.verdict === "block").length;
      const warned = list.filter((s) => s.verdict === "warn").length;
      toast().show(
        t("safety.batchDone", { count: list.length }) +
          (blocked ? t("safety.batchBlocked", { count: blocked }) : "") +
          (warned ? t("safety.batchWarned", { count: warned }) : ""),
        blocked > 0 ? "error" : "success",
      );
    } catch (error) {
      console.error(error);
      toast().show(t("safety.batchFailed"), "error");
    } finally {
      setAuditing(false);
    }
  };

  const openReport = async (skillId: string) => {
    setSelectedId(skillId);
    setSelectedReport(null);
    setExpandedFindings({});
    setLoadingReport(true);
    try {
      const report = await getSkillAudit(skillId);
      setSelectedReport(report);
    } catch (error) {
      console.error(error);
      toast().show(t("safety.drawerReportFailed"), "error");
      setSelectedId(null);
    } finally {
      setLoadingReport(false);
    }
  };

  // 从 Skill 详情跳转过来：自动打开对应报告（仅挂载时处理一次）
  useEffect(() => {
    if (auditFocusSkillId) {
      openReport(auditFocusSkillId);
      setAuditFocusSkillId(null);
    }
  }, []);

  const selectedSkill = selectedId ? skills.find((s) => s.id === selectedId) ?? null : null;

  /** 断开技能的全部连接；遇到共享软链先弹确认 */
  const disconnectAll = async (skill: Skill) => {
    for (const agentId of skill.links) {
      try {
        await disconnectSkill(skill.id, agentId, false);
      } catch (error) {
        const confirmation = parseSharedDisconnectError(error);
        if (!confirmation) {
          toast().show(t("safety.disconnectFailed"), "error");
          console.error(error);
          return;
        }
        useSkillsStore.setState({
          connectionConfirmation: {
            ...confirmation,
            skillId: skill.id,
            agentId,
            skillIds: [skill.id],
          },
        });
        return;
      }
    }
    toast().show(t("safety.disconnectDone"));
    await Promise.all([loadSkills(), loadActivity()]);
  };

  const connectionConfirmation = useSkillsStore((s) => s.connectionConfirmation);
  const connectionConfirming = useSkillsStore((s) => s.connectionConfirming);
  const cancelSharedDisconnect = useSkillsStore((s) => s.cancelSharedDisconnect);
  const confirmSharedDisconnect = useSkillsStore((s) => s.confirmSharedDisconnect);
  const skillDeleteConfirmation = useSkillsStore((s) => s.skillDeleteConfirmation);
  const skillDeleting = useSkillsStore((s) => s.skillDeleting);
  const cancelSkillDelete = useSkillsStore((s) => s.cancelSkillDelete);
  const confirmSkillDelete = useSkillsStore((s) => s.confirmSkillDelete);

  // ===================== 空态引导 =====================
  if (skills.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto" data-testid="audit-view">
        <div className="max-w-[640px] mx-auto text-center pt-12">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 flex items-center justify-center mx-auto">
            <ShieldCheck size={26} />
          </div>
          <h2 className="text-lg font-bold text-heading mt-3">{t("safety.emptyTitle")}</h2>
          <p className="text-xs text-muted mt-1.5 leading-relaxed">{t("safety.emptyDesc")}</p>
          <div className="grid grid-cols-3 gap-3 mt-5 text-left">
            <EmptyRiskCard icon={<Lock size={17} />} title={t("safety.emptyCard1Title")} desc={t("safety.emptyCard1Desc")} />
            <EmptyRiskCard icon={<FileWarning size={17} />} title={t("safety.emptyCard2Title")} desc={t("safety.emptyCard2Desc")} />
            <EmptyRiskCard icon={<Terminal size={17} />} title={t("safety.emptyCard3Title")} desc={t("safety.emptyCard3Desc")} />
          </div>
          <div className="mt-5 pb-10">
            <button type="button" className="btn btn-primary btn-lg" onClick={scanAndCheck} disabled={auditing}>
              {auditing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={15} />}
              {t("safety.emptyCta")}
            </button>
            <p className="text-2xs text-faint mt-2.5">{t("safety.emptyNote")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="audit-view">
      <PageHeader
        title={t("safety.title")}
        subtitle={t("safety.desc")}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRulesOpen(true)}>
              <Info size={13} /> {t("safety.rulesBtn")}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => runBatch(null)} disabled={auditing}>
              {auditing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {auditing ? t("safety.checking") : t("safety.recheckAll")}
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 状态统计卡：即筛选入口（V6 p3：危险/需留意/未检查/安全 四态，点卡片筛选，再点恢复全部） */}
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard
            testId="safety-stat-block"
            icon={<OctagonX size={13} />}
            tone="block"
            active={filter === "block"}
            label={t("safety.statBlock")}
            count={stats.block}
            desc={t("safety.statBlockDesc")}
            onClick={() => setFilter(filter === "block" ? "all" : "block")}
          />
          <StatCard
            testId="safety-stat-warn"
            icon={<TriangleAlert size={13} />}
            tone="warn"
            active={filter === "warn"}
            label={t("safety.statWarn")}
            count={stats.warn}
            desc={t("safety.statWarnDesc")}
            onClick={() => setFilter(filter === "warn" ? "all" : "warn")}
          />
          <StatCard
            testId="safety-stat-pending"
            icon={<Clock size={13} />}
            tone="pending"
            active={filter === "pending"}
            label={t("safety.statPending")}
            count={stats.pending}
            desc={t("safety.statPendingDesc")}
            onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
          />
          <StatCard
            testId="safety-stat-pass"
            icon={<Check size={13} />}
            tone="pass"
            active={filter === "pass"}
            label={t("safety.statPass")}
            count={stats.pass}
            desc={t("safety.statPassDesc")}
            onClick={() => setFilter(filter === "pass" ? "all" : "pass")}
          />
        </div>

        {/* 技能列表（按风险排序，V6 p3）：搜索在列表分组行 */}
        <div data-testid="safety-rows">
          <div className="flex items-center gap-2 mb-2">
            <SearchInput value={query} onChange={setQuery} placeholder={t("safety.searchPlaceholder")} />
          </div>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-faint">
              <ShieldCheck size={40} className="opacity-30" />
              <p className="text-sm mt-2">{t("safety.noMatch")}</p>
            </div>
          ) : (
          <div className="list-panel">
            {filtered.map((skill) => {
              const summary = summaries[skill.id];
              const summaryLine =
                skill.audit_verdict === "block"
                  ? t("safety.statBlockDesc")
                  : skill.audit_verdict === "warn"
                    ? t("safety.statWarnDesc")
                    : skill.audit_verdict === "pass"
                      ? t("safety.rowPassDesc")
                      : t("safety.rowPendingDesc");
              const checkedAt = summary ? formatAuditTime(summary.created_at) : null;
              const isDanger = skill.audit_verdict === "block";
              const isWarn = skill.audit_verdict === "warn";
              return (
                <div
                  key={skill.id}
                  onClick={() => openReport(skill.id)}
                  className={
                    "list-row list-row--audit" +
                    (isDanger ? " list-row--danger" : isWarn ? " list-row--warn" : "")
                  }
                >
                  <span
                    className={
                      "list-row__name " +
                      (isDanger
                        ? "text-red-600 dark:text-red-300"
                        : isWarn
                          ? "text-amber-600 dark:text-amber-300"
                          : skill.audit_verdict === "pass"
                            ? "text-emerald-600 dark:text-emerald-300"
                            : "text-heading")
                    }
                  >
                    {skill.name}
                  </span>
                  <span className="list-row__desc">
                    {summaryLine}
                    {checkedAt
                      ? " · " + t("safety.rowCheckedAt", { lib: skill.source_lib, time: checkedAt })
                      : " · " + t("safety.rowSource", { lib: skill.source_lib })}
                  </span>
                  <span className="list-row__tags" />
                  <div className="flex items-center gap-2 shrink-0" onClick={(event) => event.stopPropagation()}>
                    {isDanger && (
                      <button type="button" className="btn btn-ghost btn-sm text-red-500 hover:text-red-600" onClick={() => openReport(skill.id)}>
                        {t("safety.rowHandle")}
                      </button>
                    )}
                    {!isDanger && skill.audit_verdict == null && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => runBatch([skill.id])}
                        disabled={auditing}
                      >
                        <RefreshCw size={12} /> {t("safety.rowCheck")}
                      </button>
                    )}
                  </div>
                  <ChevronRight size={14} className="list-row__chev" />
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>

      {/* 详情抽屉 */}
      <DetailDrawer
        open={!!selectedSkill}
        onClose={() => setSelectedId(null)}
        testId="audit-report-drawer"
        icon={<ShieldCheck size={18} className="text-faint shrink-0" />}
        title={selectedSkill?.name ?? ""}
        subtitle={selectedSkill?.source_lib}
        headerActions={
          selectedSkill && (
            <>
              {selectedSkill.links.length > 0 && (
                <button
                  type="button"
                  onClick={() => disconnectAll(selectedSkill)}
                  className="btn-icon rounded-full bg-surface-2 text-red-500 hover:text-red-600"
                  title={t("safety.drawerDisconnect")}
                  aria-label={t("safety.drawerDisconnect")}
                >
                  <Unlink size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  useSkillsStore.getState().requestSkillDelete({
                    id: selectedSkill.id,
                    name: selectedSkill.name,
                    path: selectedSkill.path,
                  })
                }
                className="btn-icon rounded-full bg-surface-2 text-red-500 hover:text-red-600"
                title={t("safety.drawerDelete")}
                aria-label={t("safety.drawerDelete")}
              >
                <Trash2 size={14} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  await runBatch([selectedSkill.id]);
                  await openReport(selectedSkill.id);
                }}
                disabled={auditing}
                className="btn-icon rounded-full bg-surface-2"
                title={t("safety.drawerRecheck")}
                aria-label={t("safety.drawerRecheck")}
              >
                <RefreshCw size={14} className={auditing ? "animate-spin" : ""} />
              </button>
            </>
          )
        }
      >
        {loadingReport || !selectedReport ? (
          <div className="flex items-center justify-center py-10 text-faint">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : selectedSkill ? (
          <SafetyDrawerBody
            skill={selectedSkill}
            report={selectedReport}
            expandedFindings={expandedFindings}
            onToggleFinding={(key) =>
              setExpandedFindings((current) => ({ ...current, [key]: !current[key] }))
            }
          />
        ) : null}
      </DetailDrawer>

      <AuditRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <ConnectionConfirmationDialog
        confirmation={connectionConfirmation}
        confirming={connectionConfirming}
        onCancel={cancelSharedDisconnect}
        onConfirm={confirmSharedDisconnect}
      />
      <SkillDeleteDialog
        confirmation={skillDeleteConfirmation}
        deleting={skillDeleting}
        onCancel={cancelSkillDelete}
        onConfirm={confirmSkillDelete}
      />
    </div>
  );
}

function EmptyRiskCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card p-3.5">
      <span className="text-red-500">{icon}</span>
      <div className="text-xs font-semibold text-heading mt-2">{title}</div>
      <p className="text-2xs text-muted mt-0.5 leading-relaxed">{desc}</p>
    </div>
  );
}

const STAT_TONE_CLASSES = {
  pass: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  block: "text-red-600 dark:text-red-300",
  pending: "text-amber-600 dark:text-amber-300",
} as const;

function StatCard({
  testId,
  icon,
  tone,
  active,
  label,
  count,
  desc,
  onClick,
}: {
  testId: string;
  icon: React.ReactNode;
  tone: keyof typeof STAT_TONE_CLASSES;
  active: boolean;
  label: string;
  count: number;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={"card p-3 text-left transition-colors hover:border-border-strong " + (active ? "border-accent" : "")}
    >
      <div className={"flex items-center gap-1.5 text-2xs font-semibold " + STAT_TONE_CLASSES[tone]}>
        {icon} {label}
      </div>
      <div className="text-xl font-bold text-heading mt-1">{count}</div>
      <div className="text-2xs text-faint mt-0.5 leading-snug">{desc}</div>
    </button>
  );
}

function SafetyDrawerBody({
  skill,
  report,
  expandedFindings,
  onToggleFinding,
}: {
  skill: Skill;
  report: AuditReport;
  expandedFindings: Record<string, boolean>;
  onToggleFinding: (key: string) => void;
}) {
  const t = useT();
  const verdict = report.verdict;

  const bannerTone =
    verdict === "block"
      ? "bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800"
      : verdict === "warn"
        ? "bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800"
        : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800";
  const bannerTitleClass =
    verdict === "block"
      ? "text-red-600 dark:text-red-300"
      : verdict === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : "text-emerald-600 dark:text-emerald-300";
  const bannerTitle =
    verdict === "block"
      ? t("safety.drawerVerdictBlock")
      : verdict === "warn"
        ? t("safety.drawerVerdictWarn")
        : t("safety.drawerVerdictPass");
  const BannerIcon = verdict === "block" ? OctagonX : verdict === "warn" ? TriangleAlert : ShieldCheck;

  const findings = mergeFindings(report.findings);

  return (
    <div className="px-5 py-4 space-y-4" data-testid="safety-drawer-body">
      <div className={"rounded-lg border p-3.5 flex gap-2.5 " + bannerTone}>
        <BannerIcon size={17} className={"shrink-0 mt-0.5 " + bannerTitleClass} />
        <div className="min-w-0">
          <div className={"text-xs font-semibold " + bannerTitleClass}>{bannerTitle}</div>
          {findings.length > 0 && (
            <p className="text-2xs text-content leading-relaxed mt-1">
              {ruleExplanation(findings[0].rule_id) ?? findings[0].message}
            </p>
          )}
        </div>
      </div>

      {findings.length > 0 && (
        <>
          <div className="text-2xs font-semibold text-muted uppercase tracking-wider">
            {t("safety.drawerFindings")}
          </div>
          <div className="space-y-2">
            {groupFindings(findings).map((group) => {
              const open = expandedFindings[group.key];
              const toneClass =
                group.severity === "block"
                  ? "text-red-600 dark:text-red-300"
                  : group.severity === "warn"
                    ? "text-amber-600 dark:text-amber-300"
                    : "text-sky-600 dark:text-sky-300";
              const explanations = [
                ...new Set(
                  group.rules.map((rule) => ruleExplanation(rule.rule_id) ?? rule.message),
                ),
              ];
              return (
                <div key={group.key} className="rounded-lg border border-border-subtle bg-surface p-2.5">
                  <div className="flex items-start gap-2">
                    {group.severity === "block" ? (
                      <OctagonX size={13} className="text-red-500 shrink-0 mt-0.5" />
                    ) : group.severity === "warn" ? (
                      <TriangleAlert size={13} className="text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <Info size={13} className="text-sky-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={"text-xs font-semibold leading-relaxed " + toneClass}>
                          {group.title}
                        </span>
                        {group.count > 1 && (
                          <span className="text-2xs text-faint">
                            {t("safety.drawerFindingCount", { count: group.count })}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 space-y-0.5">
                        {explanations.map((explanation) => (
                          <p key={explanation} className="text-2xs text-muted leading-relaxed">
                            {explanation}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-2xs text-accent mt-1.5 ml-5"
                    onClick={() => onToggleFinding(group.key)}
                  >
                    {t("safety.drawerDetailToggle")}
                    {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                  {open && (
                    <div className="ml-5 mt-1.5 rounded bg-surface-2 p-2 text-2xs text-muted leading-relaxed space-y-1.5">
                      {group.rules.map((rule, ruleIndex) => (
                        <div key={`${rule.rule_id}-${ruleIndex}`}>
                          <div>{rule.message}</div>
                          <div className="text-faint font-mono mt-1 space-y-0.5">
                            <div>{t("market.dlgRuleRef", { id: rule.rule_id })}</div>
                            {rule.locations.map((location) => (
                              <div key={location} className="truncate" title={location}>{location}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {findings.length === 0 && (
        <p className="text-2xs text-faint">{t("safety.drawerNoFindings")}</p>
      )}
    </div>
  );
}
