import assert from "node:assert/strict";
import test from "node:test";
import type { AuditFinding } from "../src/types";
import {
  auditVerdictMeta,
  needsUserConfirm,
  sortFindingsBySeverity,
  INSTALL_STATUS_META,
  scoreGradeMeta,
} from "../src/lib/skillAudit";
import { formatAuditTime } from "../src/lib/auditTime";

test("audit verdict meta maps known verdicts and rejects unknown values", () => {
  assert.equal(auditVerdictMeta("pass")?.label, "安全");
  assert.equal(auditVerdictMeta("warn")?.label, "需留意");
  assert.equal(auditVerdictMeta("block")?.label, "危险");
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

test("score grade maps by threshold and rejects null", () => {
  assert.equal(scoreGradeMeta(null), null);
  assert.equal(scoreGradeMeta(undefined), null);
  assert.equal(scoreGradeMeta(100)?.label, "优");
  assert.equal(scoreGradeMeta(90)?.label, "优");
  assert.equal(scoreGradeMeta(89)?.label, "良");
  assert.equal(scoreGradeMeta(75)?.label, "良");
  assert.equal(scoreGradeMeta(60)?.label, "中");
  assert.equal(scoreGradeMeta(59)?.label, "差");
  assert.equal(scoreGradeMeta(0)?.label, "差");
});

test("formatAuditTime renders local MM-DD HH:mm and tolerates invalid input", () => {
  assert.equal(formatAuditTime(null), "—");
  assert.equal(formatAuditTime(undefined), "—");
  assert.equal(formatAuditTime("not-a-date"), "not-a-date");
  const local = new Date(2026, 8, 13, 9, 5); // 本地时区 2026-09-13 09:05
  assert.equal(formatAuditTime(local.toISOString()), "09-13 09:05");
  // 后端 skill_audits.created_at 存的是 epoch 秒字符串
  assert.equal(formatAuditTime(String(Math.floor(local.getTime() / 1000))), "09-13 09:05");
  // epoch 毫秒同样支持
  assert.equal(formatAuditTime(String(local.getTime())), "09-13 09:05");
});
