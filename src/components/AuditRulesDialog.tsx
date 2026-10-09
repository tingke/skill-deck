import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileWarning,
  Globe,
  Info,
  Lock,
  Package,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import type { AuditRuleInfo, AuditRulesResponse } from "../types";
import { getAuditRules } from "../lib/tauri";
import { RULE_GROUP_META, ruleExplanation } from "../lib/skillAudit";
import { useT } from "../i18n";

const GROUP_ORDER = ["偷隐私", "伤文件", "乱执行", "网络与诱导", "没查全"] as const;

const GROUP_ICONS: Record<string, React.ReactNode> = {
  lock: <Lock size={14} />,
  file: <FileWarning size={14} />,
  terminal: <Terminal size={14} />,
  globe: <Globe size={14} />,
  package: <Package size={14} />,
};

export default function AuditRulesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [rules, setRules] = useState<AuditRulesResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    getAuditRules()
      .then(setRules)
      .catch((error) => console.error(error));
  }, [open]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, AuditRuleInfo[]>();
    for (const rule of rules?.rules ?? []) {
      const group = RULE_GROUP_META[rule.rule_id]?.group ?? null;
      const key = group ?? "__other__";
      const list = byGroup.get(key) ?? [];
      list.push(rule);
      byGroup.set(key, list);
    }
    const ordered: { title: string; rules: AuditRuleInfo[] }[] = [];
    for (const group of GROUP_ORDER) {
      const list = byGroup.get(group);
      if (list?.length) ordered.push({ title: group, rules: list });
    }
    const other = byGroup.get("__other__");
    if (other?.length) ordered.push({ title: t("safety.rulesOther"), rules: other });
    return ordered;
  }, [rules, t]);

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
              {t("safety.rulesTitle")}
            </h3>
            <p className="connection-dialog-message" style={{ margin: 0 }}>
              {t("safety.rulesSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="audit-rules-list">
          {groups.map((group) => (
            <div key={group.title} className="rounded-lg border border-border-subtle p-3 mb-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-heading">
                <span className="text-red-500">
                  {GROUP_ICONS[RULE_GROUP_META[group.rules[0].rule_id]?.icon ?? "lock"]}
                </span>
                {group.title}
              </div>
              <ul className="mt-2 space-y-2">
                {group.rules.map((rule) => {
                  const key = rule.rule_id;
                  const openRule = expanded[key];
                  const explanation = ruleExplanation(key);
                  return (
                    <li key={key}>
                      <div className="text-2xs font-medium text-content">{rule.title}</div>
                      <p className="text-2xs text-muted leading-relaxed mt-0.5">{rule.description}</p>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-2xs text-faint hover:text-muted mt-0.5"
                        onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
                      >
                        {openRule ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {t("safety.rulesToggleDetail")}
                      </button>
                      {openRule && (
                        <div className="mt-1 rounded bg-surface-2 p-2 text-2xs text-muted leading-relaxed">
                          {explanation}
                          <div className="text-faint font-mono mt-1">{rule.rule_id}</div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {rules && rules.rules.length === 0 && (
            <div className="text-2xs text-faint flex items-center gap-1.5">
              <Info size={12} /> —
            </div>
          )}
        </div>

        <div className="connection-dialog-actions shrink-0">
          <p className="text-2xs text-faint mr-auto leading-relaxed">{t("safety.rulesFooter")}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose} autoFocus>
            {t("safety.rulesClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
