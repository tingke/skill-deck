import assert from "node:assert/strict";
import test from "node:test";
import type { AuditFinding } from "../src/types";
import {
  auditVerdictMeta,
  needsUserConfirm,
  sortFindingsBySeverity,
  INSTALL_STATUS_META,
} from "../src/lib/skillAudit";

test("audit verdict meta maps known verdicts and rejects unknown values", () => {
  assert.equal(auditVerdictMeta("pass")?.label, "通过");
  assert.equal(auditVerdictMeta("warn")?.label, "警告");
  assert.equal(auditVerdictMeta("block")?.label, "阻断");
  assert.equal(auditVerdictMeta(null), null);
  assert.equal(auditVerdictMeta("unknown"), null);
});

test("only gated statuses require user confirmation before override", () => {
  assert.equal(needsUserConfirm("audit_blocked"), true);
  assert.equal(needsUserConfirm("audit_warned"), true);
  assert.equal(needsUserConfirm("local_changes"), true);
  assert.equal(needsUserConfirm("installed"), false);
  assert.equal(needsUserConfirm("updated"), false);
  assert.equal(needsUserConfirm("up_to_date"), false);
  assert.equal(needsUserConfirm("conflict"), false);
});

test("findings sort by severity with block first", () => {
  const findings: AuditFinding[] = [
    { rule_id: "SEC-004", severity: "warn", location: "a", message: "" },
    { rule_id: "SEC-001", severity: "block", location: "b", message: "" },
    { rule_id: "SEC-010", severity: "info", location: "c", message: "" },
  ];
  const sorted = sortFindingsBySeverity(findings);
  assert.deepEqual(
    sorted.map((finding) => finding.severity),
    ["block", "warn", "info"],
  );
  // 原数组不被修改
  assert.equal(findings[0].severity, "warn");
});

test("every install status has display metadata", () => {
  for (const [status, meta] of Object.entries(INSTALL_STATUS_META)) {
    assert.ok(meta.label.length > 0, `${status} should have a label`);
    assert.equal(typeof meta.blocked, "boolean");
  }
});
