import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";

/**
 * Shared right-side detail drawer (V1 Inspector).
 * 操作按钮（actions / headerActions）统一渲染在顶部标题右侧；
 * actions 兼容旧用法，会与 headerActions 并排出现。
 */
export default function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  actions,
  headerActions,
  testId,
  fillBody = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** 顶部操作按钮（图标钮），渲染在标题右侧、关闭钮左边。 */
  headerActions?: ReactNode;
  testId?: string;
  /** true 时 body 为 flex 容器且不滚动，由 children 自行管理内部滚动 */
  fillBody?: boolean;
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="detail-drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside role="dialog" aria-modal="true" data-testid={testId} className="detail-drawer">
        <header className="detail-drawer-header">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              {icon}
              <h3 className="detail-drawer-title truncate">{title}</h3>
            </div>
            {subtitle && <div className="detail-drawer-subtitle">{subtitle}</div>}
          </div>
          {(headerActions || actions) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {actions}
              {headerActions}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0 rounded-full bg-surface-2"
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={14} />
          </button>
        </header>

        <div className={"detail-drawer-body" + (fillBody ? " detail-drawer-body--fill" : "")}>{children}</div>
      </aside>
    </div>
  );
}
