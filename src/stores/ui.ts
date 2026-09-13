import { create } from "zustand";
import type { ViewKey } from "../types";

interface UiState {
  view: ViewKey;
  searchQuery: string;
  theme: "light" | "dark" | "system";
  setView: (v: ViewKey) => void;
  setSearchQuery: (q: string) => void;
  setTheme: (t: "light" | "dark" | "system") => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "dashboard",
  searchQuery: "",
  theme: (localStorage.getItem("theme") as "light" | "dark" | "system") || "light",
  setView: (v) => set({ view: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setTheme: (t) => { set({ theme: t }); localStorage.setItem("theme", t); },
}));
