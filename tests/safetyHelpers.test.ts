import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_VERDICT_META,
  RULE_EXPLANATIONS,
  RULE_GROUP_META,
  auditRiskRank,
  averageAuditScore,
  auditStats,
  mergeFindings,
  ruleExplanation,
} from "../src/lib/skillAudit";

test("verdict labels use plain-language terms", () => {
  assert.equal(AUDIT_VERDICT_META.pass.label, "安全");
  assert.equal(AUDIT_VERDICT_META.warn.label, "需留意");
  assert.equal(AUDIT_VERDICT_META.block.label, "危险");
});

test("every known audit rule has a plain-language explanation and group", () => {
  for (const ruleId of Object.keys(RULE_GROUP_META)) {
    assert.ok(ruleExplanation(ruleId), `${ruleId} should have an explanation`);
  }
  for (const ruleId of Object.keys(RULE_EXPLANATIONS)) {
    assert.ok(RULE_GROUP_META[ruleId], `${ruleId} should belong to a group`);
  }
});

test("ruleExplanation returns null for unknown rules", () => {
  assert.equal(ruleExplanation("SEC-999"), null);
});

test("auditRiskRank orders danger first and safe last", () => {
  assert.ok(auditRiskRank("block") < auditRiskRank("warn"));
  assert.ok(auditRiskRank("warn") < auditRiskRank(null));
  assert.ok(auditRiskRank(null) < auditRiskRank("pass"));
  assert.ok(auditRiskRank(undefined) === auditRiskRank(null));
});

test("averageAuditScore averages audited skills only", () => {
  assert.equal(averageAuditScore([]), null);
  assert.equal(averageAuditScore([{ audit_score: null }]), null);
  assert.equal(
    averageAuditScore([{ audit_score: 90 }, { audit_score: 70 }, { audit_score: null }]),
    80,
  );
});

test("auditStats counts the four plain states", () => {
  assert.deepEqual(
    auditStats([
      { audit_verdict: "pass" },
      { audit_verdict: "pass" },
      { audit_verdict: "warn" },
      { audit_verdict: "block" },
      { audit_verdict: null },
    ]),
    { pass: 2, warn: 1, block: 1, pending: 1 },
  );
});

test("mergeFindings dedupes identical checks and keeps all locations", () => {
  const merged = mergeFindings([
    { rule_id: "SEC-005", severity: "warn", message: "疑似混淆 / 运行时解码执行", location: "a.sh" },
    { rule_id: "SEC-005", severity: "warn", message: "疑似混淆 / 运行时解码执行", location: "b.sh" },
    { rule_id: "SEC-005", severity: "warn", message: "疑似混淆 / 运行时解码执行", location: "a.sh" },
    { rule_id: "SEC-001", severity: "block", message: "疑似读取凭据", location: ".env" },
  ]);
  assert.equal(merged.length, 2);
  // 危险项排在前面
  assert.equal(merged[0].rule_id, "SEC-001");
  assert.equal(merged[1].rule_id, "SEC-005");
  assert.equal(merged[1].count, 3);
  // 相同位置只保留一份
  assert.deepEqual(merged[1].locations, ["a.sh", "b.sh"]);
});
