import { useState } from "react";
import { GitBranch, Loader2, RefreshCw, ArrowUp, TriangleAlert } from "lucide-react";
import type { Skill, AgentInfo, UpdateAvailability, InstallResult } from "../../types";
import { checkSkillUpdates, updateSkill } from "../../lib/tauri";
import { INSTALL_STATUS_META, needsUserConfirm } from "../../lib/skillAudit";
import AuditFindings from "../AuditFindings";
import { useToastStore } from "../../stores/toast";
import { useSkillsStore } from "../../stores/skills";
import { useT } from "../../i18n";

interface UpdateOptions {
  overrideAudit: boolean;
  allowLocalChanges: boolean;
}

export function SkillUpdateSection({ skill, agentOptions }: { skill: Skill; agentOptions: AgentInfo[] }) {
  const t = useT();
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
        useToastStore.getState().show(t("skills.detail.upToDate"));
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(t("skills.detail.checkUpdateFailed"), "error");
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async ({ overrideAudit, allowLocalChanges }: UpdateOptions) => {
    setUpdating(true);
    try {
      const updateResult = await updateSkill(skill.id, overrideAudit, allowLocalChanges);
      setResult(updateResult);
      if (updateResult.status === "updated") {
        useToastStore.getState().show(t("skills.detail.updated", { name: updateResult.skill_name }));
        await useSkillsStore.getState().loadSkills();
        await useSkillsStore.getState().loadSkillAudit(skill.id);
        setAvailability(null);
        setConfirming(false);
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(
        error instanceof Error ? error.message : t("skills.detail.updateFailed"),
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
        <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("skills.detail.originTitle")}</span>
        <button
          onClick={runCheck}
          disabled={checking || updating}
          className="ml-auto flex items-center gap-1 text-2xs text-faint hover:text-accent transition-colors"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {t("skills.detail.checkUpdate")}
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="text-faint shrink-0">{t("skills.detail.originTitle").split(" ")[0]}</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-2 text-muted font-medium shrink-0">
            {skill.origin_type === "git" ? t("skills.detail.originGit") : skill.origin_type === "archive" ? t("skills.detail.originZip") : t("skills.detail.originLocal")}
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
            <ArrowUp size={12} /> {t("skills.detail.updateBtn")}
          </button>
        )}

        {availability?.has_update && confirming && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <div className="text-2xs text-muted leading-relaxed">
              {t("skills.detail.updateConfirmDesc")}
              {availability.local_changes && (
                <span className="text-amber-600 dark:text-amber-400"> {t("skills.detail.updateLocalChanges")}</span>
              )}
            </div>
            {affectedLabels.length > 0 && (
              <div className="text-2xs text-faint">
                {t("skills.detail.updateAffected", { agents: affectedLabels.join("、") })}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={updating}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => runUpdate({ overrideAudit: false, allowLocalChanges: availability.local_changes })}
                disabled={updating}
              >
                {updating ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />} {t("skills.detail.updateConfirm")}
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
                runUpdate({
                  overrideAudit: result.status !== "local_changes",
                  allowLocalChanges: availability?.local_changes || result.status === "local_changes",
                })
              }
              disabled={updating}
            >
              {updating ? <Loader2 size={12} className="animate-spin" /> : <TriangleAlert size={12} />}
              {result.status === "local_changes" ? t("skills.detail.updateOverrideLocal") : t("skills.detail.updateOverrideRisk")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
