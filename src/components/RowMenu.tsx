import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  /** 危险动作（删除等）→ 红字；红色只允许出现在这个菜单层 */
  danger?: boolean;
  onSelect: () => void;
}

/**
 * 统一行内「更多」菜单：列表行尾至多一个图标钮，
 * 编辑/删除等次级与危险操作收进这里，替代行内常驻的红色垃圾桶。
 * 点击外部或 Escape 关闭。
 */
export default function RowMenu({
  items,
  ariaLabel,
}: {
  items: RowMenuItem[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-dropdown min-w-[140px] rounded-lg border border-border bg-surface shadow-lg py-1"
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-surface-2 ${
                it.danger
                  ? "text-red-500 hover:text-red-600"
                  : "text-muted hover:text-content dark:hover:text-content"
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
