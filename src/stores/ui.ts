import { create } from "zustand";
import type { ViewKey } from "../types";

interface UiState {
  view: ViewKey;
  searchQuery: string;
  theme: "light" | "dark" | "system";
  /** 跨视图跳转：审计页挂载时自动打开该 skill 的审查报告 */
  auditFocusSkillId: string | null;
  /** 跨视图跳转：规则页挂载时以此草稿打开新建规则编辑器 */
  pendingRuleDraft: { title: string; content: string; tags: string[] } | null;
  setView: (v: ViewKey) => void;
  setSearchQuery: (q: string) => void;
  setTheme: (t: "light" | "dark" | "system") => void;
  setAuditFocusSkillId: (id: string | null) => void;
  setPendingRuleDraft: (draft: { title: string; content: string; tags: string[] } | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "dashboard",
  searchQuery: "",
  theme: (localStorage.getItem("theme") as "light" | "dark" | "system") || "light",
  auditFocusSkillId: null,
  pendingRuleDraft: null,
  setView: (v) => set({ view: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setTheme: (t) => { set({ theme: t }); localStorage.setItem("theme", t); },
  setAuditFocusSkillId: (id) => set({ auditFocusSkillId: id }),
  setPendingRuleDraft: (draft) => set({ pendingRuleDraft: draft }),
}));
