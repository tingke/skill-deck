import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { AuditRulesResponse } from "../types";
import { getAuditRules } from "../lib/tauri";
import { AUDIT_SEVERITY_META } from "../lib/skillAudit";

export default function AuditRulesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<AuditRulesResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    getAuditRules()
      .then(setRules)
      .catch((error) => console.error(error));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-rules-title"
        data-testid="audit-rules-dialog"
        className="audit-rules-dialog"
      >
        <div className="flex items-center gap-2 shrink-0">
          <div className="connection-dialog-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="audit-rules-title" className="connection-dialog-title">
              审计规则
            </h3>
            <p className="connection-dialog-message" style={{ margin: 0 }}>
              {rules
                ? `共 ${rules.rules.length} 条 · 得分模型：满分 ${rules.score_model.base}，Block −${rules.score_model.block_penalty} · Warn −${rules.score_model.warn_penalty} · Info −${rules.score_model.info_penalty}，最低 0 分`
                : "加载中…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="audit-rules-list">
          {rules?.rules.map((rule) => {
            const meta = AUDIT_SEVERITY_META[rule.severity];
            return (
              <div key={rule.rule_id} className="flex items-start gap-2.5">
                <span className="text-2xs font-mono text-faint shrink-0 pt-0.5">
                  {rule.rule_id}
                </span>
                <span
                  className={"shrink-0 text-2xs px-1.5 py-0.5 rounded font-medium " + meta.badge}
                >
                  {meta.label}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-heading">{rule.title}</div>
                  <p className="text-2xs text-muted leading-relaxed mt-0.5">
                    {rule.description}
                  </p>
                </div>
              </div>
            );
          })}
          {rules && rules.rules.length === 0 && (
            <div className="text-2xs text-faint">暂无规则</div>
          )}
        </div>

        <div className="connection-dialog-actions shrink-0">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
