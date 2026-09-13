import { create } from "zustand";
import type { ExtensionRow } from "../types";
import * as api from "../lib/tauri";

interface ExtensionsState {
  extensions: ExtensionRow[];
  loadExtensions: () => Promise<void>;
}

export const useExtensionsStore = create<ExtensionsState>((set) => ({
  extensions: [],
  loadExtensions: async () => {
    try { set({ extensions: await api.getExt() }); } catch { /* ignore */ }
  },
}));
