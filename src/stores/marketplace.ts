import { create } from "zustand";
import type { MarketplaceCatalog } from "../types";
import * as api from "../lib/tauri";
import { DEFAULT_MCP_REGISTRY_URL, DEFAULT_SKILL_SOURCE_URL } from "../lib/marketplace";
import { tr } from "../i18n";
import { useToastStore } from "./toast";

const MANIFEST_URL_KEY = "marketplace_manifest_url";

interface MarketplaceState {
  /** 官方工具目录（MCP Registry） */
  officialMcpCatalog: MarketplaceCatalog | null;
  /** 官方技能目录（anthropics/skills） */
  officialSkillCatalog: MarketplaceCatalog | null;
  /** 团队目录（HTTPS manifest，技能+工具），与官方目录合并展示 */
  customCatalog: MarketplaceCatalog | null;
  officialMcpSyncing: boolean;
  officialSkillSyncing: boolean;
  customSyncing: boolean;
  officialMcpError: string | null;
  officialSkillError: string | null;
  customError: string | null;
  manifestUrl: string;
  /** 首次进入商店页自动同步官方目录（每次启动只尝试一次） */
  autoSynced: boolean;
  syncOfficialMcps: () => Promise<void>;
  syncOfficialSkills: () => Promise<void>;
  syncCustom: () => Promise<void>;
  setManifestUrl: (url: string) => void;
  markAutoSynced: () => void;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  officialMcpCatalog: null,
  officialSkillCatalog: null,
  customCatalog: null,
  officialMcpSyncing: false,
  officialSkillSyncing: false,
  customSyncing: false,
  officialMcpError: null,
  officialSkillError: null,
  customError: null,
  manifestUrl: localStorage.getItem(MANIFEST_URL_KEY) || "",
  autoSynced: false,

  syncOfficialMcps: async () => {
    if (get().officialMcpSyncing) return;
    set({ officialMcpSyncing: true, officialMcpError: null });
    try {
      const catalog = await api.syncMarketplace({ url: DEFAULT_MCP_REGISTRY_URL, max_items: 300 });
      set({ officialMcpCatalog: catalog, officialMcpSyncing: false });
    } catch (error) {
      set({ officialMcpSyncing: false, officialMcpError: String(error) });
    }
  },

  syncOfficialSkills: async () => {
    if (get().officialSkillSyncing) return;
    set({ officialSkillSyncing: true, officialSkillError: null });
    try {
      const catalog = await api.syncMarketplace({ url: DEFAULT_SKILL_SOURCE_URL, max_items: 300 });
      set({ officialSkillCatalog: catalog, officialSkillSyncing: false });
    } catch (error) {
      set({ officialSkillSyncing: false, officialSkillError: String(error) });
    }
  },

  syncCustom: async () => {
    const { manifestUrl, customSyncing } = get();
    const url = manifestUrl.trim();
    if (customSyncing || !url) return;
    set({ customSyncing: true, customError: null });
    try {
      const catalog = await api.syncMarketplace({ url, max_items: 300 });
      set({ customCatalog: catalog, customSyncing: false });
      useToastStore.getState().show(tr("market.syncDone", {
        name: catalog.name,
        skills: catalog.skills.length,
        mcps: catalog.mcps.length,
      }));
    } catch (error) {
      set({ customSyncing: false, customError: String(error) });
    }
  },

  setManifestUrl: (url) => {
    set({ manifestUrl: url });
    localStorage.setItem(MANIFEST_URL_KEY, url);
  },

  markAutoSynced: () => {
    set({ autoSynced: true });
  },
}));
