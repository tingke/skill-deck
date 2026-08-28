import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";

/**
 * Shared right-side detail drawer for card-based views.
 * Click a card to open; edit / delete actions live inside the drawer footer.
 */
export default function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  actions,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
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
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0"
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="detail-drawer-body">{children}</div>

        {actions && <footer className="detail-drawer-footer">{actions}</footer>}
      </aside>
    </div>
  );
}
