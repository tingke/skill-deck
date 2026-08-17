/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /* Semantic color tokens — RGB triplets resolve to
         rgb(var(--token) / <alpha>) utilities, e.g. bg-surface, text-muted */
      colors: {
        page:        "rgb(var(--c-bg-page) / <alpha-value>)",
        surface:     "rgb(var(--c-surface) / <alpha-value>)",
        "surface-hover": "rgb(var(--c-surface-hover) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        overlay:     "rgb(var(--c-overlay) / <alpha-value>)",

        border:        "rgb(var(--c-border) / <alpha-value>)",
        "border-subtle": "rgb(var(--c-border-subtle) / <alpha-value>)",
        "border-strong": "rgb(var(--c-border-strong) / <alpha-value>)",

        content:    "rgb(var(--c-content) / <alpha-value>)",
        heading:    "rgb(var(--c-heading) / <alpha-value>)",
        muted:      "rgb(var(--c-muted) / <alpha-value>)",
        faint:      "rgb(var(--c-faint) / <alpha-value>)",
        "on-accent": "rgb(var(--c-on-accent) / <alpha-value>)",

        accent:           "rgb(var(--c-accent) / <alpha-value>)",
        "accent-hover":   "rgb(var(--c-accent-hover) / <alpha-value>)",
        "accent-fg":      "rgb(var(--c-accent-fg) / <alpha-value>)",
        "accent-inverse": "rgb(var(--c-accent-inverse) / <alpha-value>)",

        success:    "rgb(var(--c-success) / <alpha-value>)",
        danger:     "rgb(var(--c-danger) / <alpha-value>)",
        warning:    "rgb(var(--c-warning) / <alpha-value>)",
        info:       "rgb(var(--c-info) / <alpha-value>)",
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },

      fontSize: {
        "2xs": ["var(--text-2xs)", { lineHeight: "1.2" }],
        xs:   ["var(--text-xs)", { lineHeight: "1.3" }],
        sm:   ["var(--text-sm)", { lineHeight: "1.45" }],
        base: ["var(--text-base)", { lineHeight: "1.5" }],
        lg:   ["var(--text-lg)", { lineHeight: "1.4" }],
        xl:   ["var(--text-xl)", { lineHeight: "1.35" }],
        "2xl": ["24px", { lineHeight: "1.25" }],
      },

      borderRadius: {
        DEFAULT: "var(--radius-md)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },

      boxShadow: {
        xs: "var(--shadow-xs)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },

      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
      },

      zIndex: {
        dropdown: "var(--z-dropdown)",
        sticky: "var(--z-sticky)",
        drawer: "var(--z-drawer)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
      },
    },
  },
  plugins: [],
};
