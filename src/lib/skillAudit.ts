import type { AuditFinding, AuditSeverity, AuditVerdict, InstallStatus } from "../types";

export const AUDIT_VERDICT_META: Record<AuditVerdict, { label: string; badge: string }> = {
  pass: {
    label: "安全",
    badge: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  warn: {
    label: "需留意",
    badge: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
  },
  block: {
    label: "危险",
    badge: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300",
  },
};

export const AUDIT_SEVERITY_META: Record<AuditSeverity, { label: string; badge: string }> = {
  info: {
    label: "说明",
    badge: "text-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300",
  },
  warn: {
    label: "注意",
    badge: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
  },
  block: {
    label: "危险",
    badge: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300",
  },
};

export function auditVerdictMeta(verdict: string | null | undefined) {
  if (verdict === "pass" || verdict === "warn" || verdict === "block") {
    return AUDIT_VERDICT_META[verdict];
  }
  return null;
}

/** 得分等级：≥90 优 / ≥75 良 / ≥60 中 / <60 差；未审查返回 null */
export function scoreGradeMeta(score: number | null | undefined): {
  label: string;
  badge: string;
} | null {
  if (score == null) return null;
  if (score >= 90) {
    return {
      label: "优",
      badge: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300",
    };
  }
  if (score >= 75) {
    return {
      label: "良",
      badge: "text-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300",
    };
  }
  if (score >= 60) {
    return {
      label: "中",
      badge: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  return {
    label: "差",
    badge: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300",
  };
}

export const INSTALL_STATUS_META: Record<InstallStatus, { label: string; blocked: boolean }> = {
  installed: { label: "安装成功", blocked: false },
  updated: { label: "更新成功", blocked: false },
  up_to_date: { label: "已是最新版本", blocked: false },
  conflict: { label: "技能库中已存在同名技能，未覆盖", blocked: true },
  audit_blocked: { label: "安全检查发现危险，已停止安装", blocked: true },
  audit_warned: { label: "安全检查发现风险，需确认后继续", blocked: true },
  local_changes: { label: "本地已有改动，更新会覆盖", blocked: true },
};

/** 安装/更新被门禁拦下时，需要用户确认后再带 override 重试的状态 */
export function needsUserConfirm(status: InstallStatus): boolean {
  return (
    status === "audit_blocked" ||
    status === "audit_warned" ||
    status === "local_changes"
  );
}

export function sortFindingsBySeverity<T extends { severity: AuditSeverity }>(findings: T[]): T[] {
  const order: Record<AuditSeverity, number> = { block: 0, warn: 1, info: 2 };
  return [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 体检规则 → 白话解释：告诉用户「这条规则查的是什么、后果是什么」 */
export const RULE_EXPLANATIONS: Record<string, string> = {
  "SEC-001": "密码、密钥这类凭据存在固定位置。这个技能会去读取——拿到就等于拿到你的账号，可能被冒用或外泄。",
  "SEC-002": "会执行删除整个磁盘、格式化等无法撤销的破坏性命令，可能直接弄坏你的系统或文件。",
  "SEC-003": "会从网上下载程序并直接运行，下载到什么内容无法事先检查。",
  "SEC-004": "会把自己加进开机自启或终端配置里，即使关掉应用，重启后它仍在后台生效。",
  "SEC-005": "会把要执行的命令编码混淆起来，让你看不清它实际要做什么。",
  "SEC-006": "内容里藏着诱导 AI 无视你指令的话术，可能让 AI 做出违背你预期的行为。",
  "SEC-007": "包里带了一个可直接运行的程序，静态检查无法确认它运行时做什么。",
  "SEC-008": "包含指向技能目录之外的链接，可能访问或改写你电脑上的其他文件。",
  "SEC-009": "包含压缩包，检查无法覆盖压缩包里面的内容，相当于有一部分没查。",
  "SEC-010": "有文件因权限问题无法读取，这次检查不完整。",
  "SEC-011": "包含无法识别格式的二进制内容，用途不明。",
};

export function ruleExplanation(ruleId: string): string | null {
  return RULE_EXPLANATIONS[ruleId] ?? null;
}

/** 规则分组（体检查什么弹窗）：rule_id → 白话组名 */
export const RULE_GROUP_META: Record<string, { group: string; icon: "lock" | "file" | "terminal" | "globe" | "package" }> = {
  "SEC-001": { group: "偷隐私", icon: "lock" },
  "SEC-002": { group: "伤文件", icon: "file" },
  "SEC-008": { group: "伤文件", icon: "file" },
  "SEC-003": { group: "乱执行", icon: "terminal" },
  "SEC-004": { group: "乱执行", icon: "terminal" },
  "SEC-005": { group: "乱执行", icon: "terminal" },
  "SEC-007": { group: "乱执行", icon: "terminal" },
  "SEC-011": { group: "乱执行", icon: "terminal" },
  "SEC-006": { group: "网络与诱导", icon: "globe" },
  "SEC-009": { group: "没查全", icon: "package" },
  "SEC-010": { group: "没查全", icon: "package" },
};

/** 安全体检列表排序：危险 → 需留意 → 未检查 → 安全 */
export function auditRiskRank(verdict: string | null | undefined): number {
  if (verdict === "block") return 0;
  if (verdict === "warn") return 1;
  if (verdict == null) return 2;
  return 3;
}

export interface MergedFinding {
  rule_id: string;
  severity: AuditSeverity;
  message: string;
  /** 同一规则 + 同一描述触发的次数 */
  count: number;
  /** 去重后的出现位置 */
  locations: string[];
}

/** 合并相同检查项：按 规则 + 严重级别 + 描述 聚合，保留全部位置；结果按严重级别排序 */
export function mergeFindings(findings: AuditFinding[]): MergedFinding[] {
  const merged = new Map<string, MergedFinding>();
  for (const finding of findings) {
    const key = `${finding.rule_id}\n${finding.severity}\n${finding.message}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += 1;
      if (finding.location && !existing.locations.includes(finding.location)) {
        existing.locations.push(finding.location);
      }
    } else {
      merged.set(key, {
        rule_id: finding.rule_id,
        severity: finding.severity,
        message: finding.message,
        count: 1,
        locations: finding.location ? [finding.location] : [],
      });
    }
  }
  const order: Record<AuditSeverity, number> = { block: 0, warn: 1, info: 2 };
  return [...merged.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 体检总分：已检查技能的平均分；一个都没查过时返回 null */
export function averageAuditScore(
  skills: { audit_score?: number | null }[],
): number | null {
  const audited = skills.filter((skill) => skill.audit_score != null);
  if (audited.length === 0) return null;
  return Math.round(
    audited.reduce((sum, skill) => sum + (skill.audit_score ?? 0), 0) / audited.length,
  );
}

/** 体检状态统计：四档白话状态各自的数量 */
export function auditStats(
  skills: { audit_verdict?: string | null }[],
): { pass: number; warn: number; block: number; pending: number } {
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
}
