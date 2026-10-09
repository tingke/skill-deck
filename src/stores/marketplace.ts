import { create } from "zustand";
import type { MarketplaceCatalog } from "../types";
import * as api from "../lib/tauri";
import { DEFAULT_MCP_REGISTRY_URL } from "../lib/marketplace";
import { tr } from "../i18n";
import { useToastStore } from "./toast";

export type MarketplaceSourceMode = "registry" | "custom";

interface MarketplaceState {
  sourceMode: MarketplaceSourceMode;
  manifestUrl: string;
  catalog: MarketplaceCatalog | null;
  syncing: boolean;
  setSourceMode: (mode: MarketplaceSourceMode) => void;
  setManifestUrl: (url: string) => void;
  sync: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  sourceMode: "registry",
  manifestUrl: localStorage.getItem("marketplace_manifest_url") || "",
  catalog: null,
  syncing: false,
  setSourceMode: (mode) => {
    if (get().sourceMode === mode) return;
    set({ sourceMode: mode, catalog: null });
  },
  setManifestUrl: (url) => {
    set({ manifestUrl: url });
    localStorage.setItem("marketplace_manifest_url", url);
  },
  sync: async () => {
    const { sourceMode, manifestUrl, syncing } = get();
    const url = sourceMode === "registry"
      ? DEFAULT_MCP_REGISTRY_URL
      : manifestUrl.trim();
    if (syncing || !url) return;

    set({ syncing: true });
    try {
      const catalog = await api.syncMarketplace({ url, max_items: 300 });
      set({ catalog, syncing: false });
      useToastStore.getState().show(tr("market.syncDone", {
        name: catalog.name,
        skills: catalog.skills.length,
        mcps: catalog.mcps.length,
      }));
    } catch (error) {
      set({ syncing: false });
      useToastStore.getState().show(
        tr("market.syncFailed", { msg: String(error) }),
        "error",
      );
    }
  },
}));
