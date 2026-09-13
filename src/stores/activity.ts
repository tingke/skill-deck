import { create } from "zustand";
import type { ActivityLog, AgentActivitySnapshot } from "../types";
import * as api from "../lib/tauri";

interface ActivityState {
  activity: ActivityLog[];
  agentActivity: AgentActivitySnapshot;
  loadActivity: () => Promise<void>;
  loadAgentActivity: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activity: [],
  agentActivity: { events: [], tasks: [] },
  loadActivity: async () => {
    try { set({ activity: await api.getRecentActivity() }); } catch { /* ignore */ }
  },
  loadAgentActivity: async () => {
    try { set({ agentActivity: await api.getAgentActivitySnapshot() }); } catch { /* ignore */ }
  },
}));
