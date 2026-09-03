import { TriangleAlert, OctagonX, Info } from "lucide-react";
import type { AuditFinding } from "../types";
import { AUDIT_SEVERITY_META, sortFindingsBySeverity } from "../lib/skillAudit";

const SEVERITY_ICONS = {
  info: Info,
  warn: TriangleAlert,
  block: OctagonX,
} as const;

export default function AuditFindings({ findings }: { findings: AuditFinding[] }) {
  const sorted = sortFindingsBySeverity(findings);
  if (sorted.length === 0) {
    return <div className="text-2xs text-faint">未发现问题</div>;
  }
  return (
    <div className="space-y-1.5">
      {sorted.map((finding, index) => {
        const meta = AUDIT_SEVERITY_META[finding.severity];
        const Icon = SEVERITY_ICONS[finding.severity];
        return (
          <div
            key={`${finding.rule_id}-${finding.location}-${index}`}
            className="flex items-start gap-2 min-w-0"
          >
            <span
              className={"flex items-center gap-1 shrink-0 text-2xs px-1.5 py-0.5 rounded font-medium " + meta.badge}
            >
              <Icon size={10} /> {meta.label}
            </span>
            <div className="min-w-0">
              <div className="text-2xs text-muted leading-relaxed">
                <span className="font-mono text-faint">{finding.rule_id}</span> {finding.message}
              </div>
              <div className="text-2xs text-faint font-mono truncate" title={finding.location}>
                {finding.location}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
