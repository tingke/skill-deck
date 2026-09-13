import { useEffect, useMemo, useState } from "react";
import { Search, ShieldCheck, Loader2, RefreshCw, BookOpen } from "lucide-react";
import { useSkillsStore } from "../stores/skills";
import { useUiStore } from "../stores/ui";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import type { AuditReport, SkillAuditSummary } from "../types";
import { auditSkillsBatch, getSkillAudit } from "../lib/tauri";
import {
  auditVerdictMeta,
  scoreGradeMeta,
} from "../lib/skillAudit";
import { formatAuditTime } from "../lib/auditTime";
import AuditFindings from "../components/AuditFindings";
import DetailDrawer from "../components/DetailDrawer";
import AuditRulesDialog from "../components/AuditRulesDialog";

const toast = () => useToastStore.getState();

export default function AuditView() {
  const t = useT();
  const skills = useSkillsStore((s) => s.skills);
  const [query, setQuery] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SkillAuditSummary>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<AuditReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const auditFocusSkillId = useUiStore((s) => s.auditFocusSkillId);
  const setAuditFocusSkillId = useUiStore((s) => s.setAuditFocusSkillId);

  const stats = useMemo(() => {
    let pass = 0;
    let warn = 0;
    let block = 0;
    let pending = 0;
    for (const skill of skills) {
      if (skill.audit_verdict === "pass") pass += 1;
      else if (skill.audit_verdict === "warn") warn += 1;
      else if (skill.audit_verdict === "block") block += 1;
      else pending += 1;
    }
    return { pass, warn, block, pending };
  }, [skills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.source_lib.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const runBatch = async (ids: string[] | null) => {
    if (auditing) return;
    setAuditing(true);
    try {
      const list = await auditSkillsBatch(ids);
      setSummaries((prev) => {
        const next = { ...prev };
        for (const summary of list) next[summary.skill_id] = summary;
        return next;
      });
      await useSkillsStore.getState().loadSkills();
      const blocked = list.filter((s) => s.verdict === "block").length;
      const warned = list.filter((s) => s.verdict === "warn").length;
      toast().show(
        `审查完成：${list.length} 个 skill${blocked ? `，阻断 ${blocked}` : ""}${warned ? `，警告 ${warned}` : ""}`,
        blocked > 0 ? "error" : "success",
      );
    } catch (error) {
      console.error(error);
      toast().show("批量审查失败", "error");
    } finally {
      setAuditing(false);
    }
  };

  const openReport = async (skillId: string) => {
    setSelectedId(skillId);
    setSelectedReport(null);
    setLoadingReport(true);
    try {
      const report = await getSkillAudit(skillId);
      setSelectedReport(report);
    } catch (error) {
      console.error(error);
      toast().show("读取审查报告失败", "error");
      setSelectedId(null);
    } finally {
      setLoadingReport(false);
    }
  };

  // 从 Skill 详情「审计详情」跳转过来：自动打开对应报告（仅挂载时处理一次）
  useEffect(() => {
    if (auditFocusSkillId) {
      openReport(auditFocusSkillId);
      setAuditFocusSkillId(null);
    }
  }, []);

  const selectedSkill = selectedId ? skills.find((s) => s.id === selectedId) ?? null : null;
  const selectedSummary = selectedId ? summaries[selectedId] ?? null : null;
  const selectedGrade = selectedReport ? scoreGradeMeta(selectedReport.score) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`筛选 ${filtered.length} 个 skill`}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <StatChip label="通过" count={stats.pass} className="text-emerald-600" />
          <StatChip label="警告" count={stats.warn} className="text-amber-600" />
          <StatChip label="阻断" count={stats.block} className="text-red-600" />
          <StatChip label="未审查" count={stats.pending} className="text-faint" />
          <button
            onClick={() => setRulesOpen(true)}
            className="btn btn-outline btn-sm shrink-0"
          >
            <BookOpen size={13} /> 审计规则
          </button>
          <button
            onClick={() => runBatch(null)}
            disabled={auditing}
            className="btn btn-primary btn-sm shrink-0"
          >
            {auditing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            全量审查
          </button>
        </div>
      </div>

      {/* skill table */}
      <div className="flex-1 overflow-y-auto bg-page">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-faint">
            <ShieldCheck size={40} className="opacity-30" />
            <p className="text-sm mt-2">{skills.length === 0 ? "点击顶部「全局扫描」加载技能库" : "没有匹配的技能"}</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {filtered.map((skill) => {
              const verdictMeta = auditVerdictMeta(skill.audit_verdict);
              const gradeMeta = scoreGradeMeta(skill.audit_score);
              const summary = summaries[skill.id];
              return (
                <div
                  key={skill.id}
                  onClick={() => openReport(skill.id)}
                  className="card px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-heading truncate">{skill.name}</span>
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted shrink-0">
                        {skill.source_lib}
                      </span>
                    </div>
                    <div className="text-2xs text-faint mt-0.5">
                      {summary
                        ? `审查于 ${formatAuditTime(summary.created_at)}`
                        : skill.audit_verdict
                          ? "已有审查结论"
                          : "尚未审查"}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {summary && summary.finding_count > 0 && (
                      <span className="text-2xs text-muted">
                        发现 <span className="text-red-500 font-medium">{summary.block_count}</span>
                        {" / "}
                        <span className="text-amber-500 font-medium">{summary.warn_count}</span>
                      </span>
                    )}
                    {skill.audit_score != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono font-semibold text-heading">{skill.audit_score}</span>
                        {gradeMeta && (
                          <span className={"text-2xs px-1.5 py-0.5 rounded font-medium " + gradeMeta.badge}>
                            {gradeMeta.label}
                          </span>
                        )}
                      </div>
                    )}
                    {verdictMeta ? (
                      <span className={"text-2xs px-2 py-0.5 rounded-md font-medium " + verdictMeta.badge}>
                        {verdictMeta.label}
                      </span>
                    ) : (
                      <span className="text-2xs px-2 py-0.5 rounded-md bg-surface-2 text-faint">未审查</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runBatch([skill.id]);
                      }}
                      disabled={auditing}
                      className="btn btn-outline btn-sm"
                      title={skill.audit_verdict ? "重新审查" : "审查"}
                    >
                      <RefreshCw size={12} />
                      {skill.audit_verdict ? "重新审查" : "审查"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* report drawer */}
      <DetailDrawer
        open={!!selectedSkill}
        onClose={() => setSelectedId(null)}
        testId="audit-report-drawer"
        icon={<ShieldCheck size={18} className="text-faint shrink-0" />}
        title={selectedSkill?.name ?? ""}
        subtitle={selectedSkill?.source_lib}
      >
        {loadingReport || !selectedReport ? (
          <div className="flex items-center justify-center py-10 text-faint">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-heading font-mono">{selectedReport.score}</span>
                <span className="text-2xs text-faint">分</span>
              </div>
              {selectedGrade && (
                <span className={"text-xs px-2 py-0.5 rounded-md font-semibold " + selectedGrade.badge}>
                  {selectedGrade.label}
                </span>
              )}
              {(() => {
                const meta = auditVerdictMeta(selectedReport.verdict);
                return meta ? (
                  <span className={"text-xs px-2 py-0.5 rounded-md font-medium " + meta.badge}>
                    {meta.label}
                  </span>
                ) : null;
              })()}
              <span className="ml-auto text-2xs text-faint">
                {formatAuditTime(selectedReport.created_at)}
              </span>
            </div>
            <AuditFindings findings={selectedReport.findings} />
            <button
              onClick={() => selectedId && runBatch([selectedId]).then(() => openReport(selectedId))}
              disabled={auditing}
              className="btn btn-outline btn-sm w-full"
            >
              <RefreshCw size={12} /> 重新审查
            </button>
          </div>
        )}
      </DetailDrawer>

      <AuditRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

function StatChip({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <span className="text-2xs shrink-0">
      <span className={className}>{label}</span>
      <span className="text-heading font-medium ml-0.5">{count}</span>
    </span>
  );
}
