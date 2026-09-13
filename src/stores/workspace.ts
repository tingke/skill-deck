import { create } from "zustand";
import type { AgentRow, ProjectRow } from "../types";
import type { LibrarySource } from "../types";
import * as api from "../lib/tauri";

interface WorkspaceState {
  agents: AgentRow[];
  projects: ProjectRow[];
  librarySources: LibrarySource[];
  loadAgents: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadLibrarySources: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  agents: [],
  projects: [],
  librarySources: [],
  loadAgents: async () => {
    try { set({ agents: await api.getAgents() }); } catch { /* ignore */ }
  },
  loadProjects: async () => {
    try { set({ projects: await api.getProjects() }); } catch { /* ignore */ }
  },
  loadLibrarySources: async () => {
    try { set({ librarySources: await api.getLibrarySources() }); } catch { /* ignore */ }
  },
}));
