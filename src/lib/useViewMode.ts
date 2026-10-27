import { useState } from "react";

export type ViewMode = "grid" | "list";

/**
 * 视图模式（网格/列表）本地持久化：每个页面用独立 key 记住上次选择。
 */
export function useViewMode(key: string): [ViewMode, (mode: ViewMode) => void] {
  const storageKey = `viewMode:${key}`;
  const [mode, setMode] = useState<ViewMode>(
    () => (localStorage.getItem(storageKey) as ViewMode) || "grid",
  );
  const change = (next: ViewMode) => {
    setMode(next);
    localStorage.setItem(storageKey, next);
  };
  return [mode, change];
}
