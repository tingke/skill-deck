import type { ReactNode } from "react";

/**
 * 统一悬浮玻璃工具栏（V6）：每页一条圆角玻璃 pill。
 * 左＝中文标题（可省，下放内容区）+ 一句副题 + 工具槽（搜索/视图切换）；
 * 右＝次级链接 + 至多一个主按钮。
 * 空白区域是窗口拖拽区（data-tauri-drag-region）。
 */
export default function PageHeader({
  title,
  subtitle,
  toolbar,
  actions,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header" data-tauri-drag-region="deep">
      {(title || subtitle) && (
        <div className="flex items-baseline gap-2 min-w-0 shrink" data-tauri-drag-region>
          {title && <h1 className="page-header__title" data-tauri-drag-region>{title}</h1>}
          {subtitle && <span className="page-header__subtitle" data-tauri-drag-region>{subtitle}</span>}
        </div>
      )}
      {toolbar && <div className="page-header__toolbar">{toolbar}</div>}
      <div className="page-header__spacer" data-tauri-drag-region />
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

/**
 * 集合页的内容区标题（V6）：大标题 + 一句 meta，随内容滚动。
 */
export function ContentTitle({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="page-content-title">
      <h1>{title}</h1>
      {meta && <p>{meta}</p>}
    </div>
  );
}
