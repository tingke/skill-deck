import { useState } from "react";
import { ShieldCheck, ChevronRight } from "lucide-react";
import type { Skill } from "../../types";
import { useSkillsStore } from "../../stores/skills";
import { useUiStore } from "../../stores/ui";
import { auditVerdictMeta, scoreGradeMeta } from "../../lib/skillAudit";
import { useT } from "../../i18n";

export function SkillAuditSection({ skill }: { skill: Skill }) {
  const t = useT();
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
        <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("skills.detail.auditTitle")}</span>
      </div>
      <button
        onClick={openAudit}
        className="w-full flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-left transition-colors hover:border-violet-300 dark:hover:border-violet-700 group"
        title={t("skills.detail.auditOpen")}
      >
        {meta ? (
          <span className={"text-2xs px-2 py-0.5 rounded-md font-medium " + meta.badge}>
            {meta.label}
          </span>
        ) : (
          <span className="text-2xs px-2 py-0.5 rounded-md bg-surface text-faint">{t("skills.detail.auditNone")}</span>
        )}
        {skillAudit && skillAudit.score != null && (
          <span className="flex items-center gap-1">
            <span className="text-xs font-mono font-semibold text-heading">{skillAudit.score}</span>
            <span className="text-2xs text-faint">{t("skills.detail.auditScoreUnit")}</span>
            {grade && (
              <span className={"text-2xs px-1.5 py-0.5 rounded font-medium " + grade.badge}>
                {grade.label}
              </span>
            )}
          </span>
        )}
        {skillAudit && skillAudit.findings.length > 0 && (
          <span className="text-2xs text-muted">
            {t("skills.detail.auditFindingCount", { count: skillAudit.findings.length })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5 text-2xs text-faint group-hover:text-violet-500 transition-colors">
          {t("skills.detail.auditOpen")} <ChevronRight size={11} />
        </span>
      </button>
    </div>
  );
}
