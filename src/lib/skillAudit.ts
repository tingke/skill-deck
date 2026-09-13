import type { AuditSeverity, AuditVerdict, InstallStatus } from "../types";

export const AUDIT_VERDICT_META: Record<AuditVerdict, { label: string; badge: string }> = {
  pass: {
    label: "通过",
    badge: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  warn: {
    label: "警告",
    badge: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
  },
  block: {
    label: "阻断",
    badge: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300",
  },
};

export const AUDIT_SEVERITY_META: Record<AuditSeverity, { label: string; badge: string }> = {
  info: {
    label: "信息",
    badge: "text-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300",
  },
  warn: {
    label: "警告",
    badge: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
  },
  block: {
    label: "阻断",
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
  conflict: { label: "库源中已存在同名 skill，未覆盖", blocked: true },
  audit_blocked: { label: "安全审查未通过（阻断级）", blocked: true },
  audit_warned: { label: "安全审查存在警告，需确认", blocked: true },
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
