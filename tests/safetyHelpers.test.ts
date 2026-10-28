import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_VERDICT_META,
  RULE_EXPLANATIONS,
  RULE_GROUP_META,
  auditRiskRank,
  auditVerdictMeta,
  averageAuditScore,
  auditStats,
  groupFindings,
  mergeFindings,
  ruleExplanation,
} from "../src/lib/skillAudit";

test("verdict labels use plain-language terms and reject unknown values", () => {
  assert.equal(AUDIT_VERDICT_META.pass.label, "安全");
  assert.equal(AUDIT_VERDICT_META.warn.label, "需留意");
  assert.equal(AUDIT_VERDICT_META.block.label, "危险");
  assert.equal(auditVerdictMeta(null), null);
  assert.equal(auditVerdictMeta("unknown"), null);
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

test("groupFindings merges same-category rules into one card ordered by severity", () => {
  const merged = mergeFindings([
    // 模拟后端输出顺序：按 rule_id 排序后同级别稳定
    { rule_id: "SEC-001", severity: "block", message: "疑似读取凭据", location: "SKILL.md:1" },
    { rule_id: "SEC-003", severity: "block", message: "下载内容直接管道执行", location: "a.sh:2" },
    { rule_id: "SEC-004", severity: "warn", message: "疑似修改 shell 配置", location: "SKILL.md:1" },
    { rule_id: "SEC-005", severity: "warn", message: "疑似混淆 / 运行时解码执行", location: "b.sh:3" },
  ]);
  const groups = groupFindings(merged);
  // 四条规则聚成两类：偷隐私（SEC-001）+ 乱执行（SEC-003/004/005）
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, "偷隐私");
  assert.equal(groups[0].severity, "block");
  assert.equal(groups[0].count, 1);
  assert.equal(groups[1].key, "乱执行");
  assert.equal(groups[1].severity, "block");
  assert.equal(groups[1].count, 3);
  assert.deepEqual(
    groups[1].rules.map((rule) => rule.rule_id),
    ["SEC-003", "SEC-004", "SEC-005"],
  );
  // 未登记的规则按自身 rule_id 独立成组，标题退回技术 message
  const unknown = groupFindings([
    { rule_id: "SEC-999", severity: "warn", message: "未知规则", count: 1, locations: [] },
  ]);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].key, "SEC-999");
  assert.equal(unknown[0].title, "未知规则");
});
