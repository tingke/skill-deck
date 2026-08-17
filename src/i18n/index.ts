import { create } from "zustand";
import { zh, type TranslationKey } from "./zh";
import { en } from "./en";

export type Lang = "zh-CN" | "en";

const dicts: Record<Lang, Record<TranslationKey, string>> = {
  "zh-CN": zh,
  en,
};

export const LANGS: { id: Lang; labelKey: TranslationKey }[] = [
  { id: "zh-CN", labelKey: "settings.lang.zh" },
  { id: "en", labelKey: "settings.lang.en" },
];

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18n = create<I18nState>((set) => ({
  lang: (localStorage.getItem("lang") as Lang) || "zh-CN",
  setLang: (l) => {
    localStorage.setItem("lang", l);
    set({ lang: l });
  },
}));

/** Translation hook. Re-renders the caller when language changes. */
export function useT() {
  const lang = useI18n((s) => s.lang);
  return (key: TranslationKey, vars?: Record<string, string | number>) => {
    let s = dicts[lang][key] ?? zh[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(`{${k}}`, String(v));
      }
    }
    return s;
  };
}

/** Non-hook translator for use in stores / callbacks. */
export function tr(key: TranslationKey, vars?: Record<string, string | number>): string {
  const lang = useI18n.getState().lang;
  let s = dicts[lang][key] ?? zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

export type { TranslationKey };
