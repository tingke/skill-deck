import { create } from "zustand";
import type { Prompt, Rule } from "../types";
import * as api from "../lib/tauri";

interface AssetsState {
  prompts: Prompt[];
  rules: Rule[];
  loadPrompts: () => Promise<void>;
  loadRules: () => Promise<void>;
}

export const useAssetsStore = create<AssetsState>((set) => ({
  prompts: [],
  rules: [],
  loadPrompts: async () => {
    try { set({ prompts: await api.getPrompts() }); } catch { /* ignore */ }
  },
  loadRules: async () => {
    try { set({ rules: await api.getRules() }); } catch { /* ignore */ }
  },
}));
