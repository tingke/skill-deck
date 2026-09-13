import { create } from "zustand";
import type { PackageRow } from "../types";
import * as api from "../lib/tauri";

interface PackagesState {
  packages: PackageRow[];
  loadPackages: () => Promise<void>;
}

export const usePackagesStore = create<PackagesState>((set) => ({
  packages: [],
  loadPackages: async () => {
    try { set({ packages: await api.getPackages() }); } catch { /* ignore */ }
  },
}));
