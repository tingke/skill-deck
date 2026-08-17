import { useState } from "react";
import {
  Sun, Moon, Search, Plus, Save, Copy, Check, Trash2, Edit3,
  RefreshCw, Download, FolderOpen, FileOutput, X, Settings,
  Box, Cpu, BookOpen, Server,
} from "lucide-react";

/* ============================================================
   Design System Reference — living style guide
   Renders every token + component defined in styles.css so the
   system can be inspected visually. Toggleable light/dark.
   ============================================================ */

const neutralSwatches = [
  ["slate-50", "#F8FAFC"], ["slate-100", "#F1F5F9"], ["slate-200", "#E2E8F0"],
  ["slate-300", "#CBD5E1"], ["slate-400", "#94A3B8"], ["slate-500", "#64748B"],
  ["slate-600", "#475569"], ["slate-700", "#334155"], ["slate-800", "#1E293B"],
  ["slate-900", "#0F172A"], ["slate-950", "#020617"],
];

const accentSwatches = [
  ["orange-500", "#F97316"], ["green-500", "#22C55E"],
  ["sky-500", "#0EA5E9"], ["violet-500", "#8B5CF6"],
  ["red-500", "#EF4444"], ["emerald-500", "#10B981"],
  ["blue-500", "#3B82F6"], ["amber-500", "#F59E0B"],
];

const typeScale = [
  ["2xs / 10px", "text-[10px]", "Badges, counters"],
  ["xs / 12px", "text-xs", "Buttons, nav, labels"],
  ["sm / 14px", "text-sm", "Body text, inputs"],
  ["lg / 18px", "text-lg", "Page titles"],
];

const radii = [
  ["sm", "4px"], ["md", "6px"], ["lg", "8px"],
  ["xl", "12px"], ["2xl", "16px"],
];

const shadows = [
  ["xs", "shadow-xs"], ["sm", "shadow"], ["md", "shadow-md"],
  ["lg", "shadow-lg"], ["xl", "shadow-xl"],
];

const iconSizes: [string, number][] = [
  ["2xs", 10], ["xs", 12], ["sm", 14], ["md", 17], ["lg", 40], ["xl", 48],
];

export default function DesignSystemView() {
  const [dark, setDark] = useState(false);

  return (
    <div className={"flex-1 flex flex-col overflow-hidden bg-page text-content " + (dark ? "dark" : "")}>
        {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-3 border-b border-border bg-surface shrink-0">
          <div className="flex items-center gap-2">
            <Box size={18} className="text-accent" />
            <h1 className="text-sm font-semibold text-heading">Design System</h1>
            <span className="badge bg-surface-2 text-muted ml-2">v1.0</span>
          </div>
          <button onClick={() => setDark(!dark)} className="btn btn-outline">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? "Light" : "Dark"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10 space-y-14 pb-20">

          {/* Colors */}
          <Section title="Color Palette" desc="Three-layer: primitive (raw) → semantic (themed) → component.">
            <h3 className="text-xs font-semibold text-muted mb-3">Neutral — Slate</h3>
            <div className="grid grid-cols-6 md:grid-cols-11 gap-2 mb-8">
              {neutralSwatches.map(([name, hex]) => (
                <div key={name}>
                  <div className="h-12 rounded-md border border-border" style={{ background: hex }} />
                  <p className="text-[10px] text-muted text-center mt-1 font-mono">{name.split("-")[1]}</p>
                </div>
              ))}
            </div>

            <h3 className="text-xs font-semibold text-muted mb-3">Accent & Status</h3>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-8">
              {accentSwatches.map(([name, hex]) => (
                <div key={name}>
                  <div className="h-12 rounded-md" style={{ background: hex }} />
                  <p className="text-[10px] text-muted text-center mt-1 font-mono">{name}</p>
                </div>
              ))}
            </div>

            <h3 className="text-xs font-semibold text-muted mb-3">Semantic Tokens (theme-aware)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <SemanticToken label="--c-bg-page" varName="--c-bg-page" />
              <SemanticToken label="--c-surface" varName="--c-surface" />
              <SemanticToken label="--c-border" varName="--c-border" />
              <SemanticToken label="--c-content" varName="--c-content" />
              <SemanticToken label="--c-muted" varName="--c-muted" />
              <SemanticToken label="--c-accent" varName="--c-accent" />
              <SemanticToken label="--c-success" varName="--c-success" />
              <SemanticToken label="--c-danger" varName="--c-danger" />
            </div>
          </Section>

          {/* Typography */}
          <Section title="Typography" desc="System font stack. Scale from 10px to 18px for a dense desktop tool.">
            <div className="space-y-1">
              {typeScale.map(([label, cls, use]) => (
                <div key={label} className="flex items-baseline gap-4 py-2 border-b border-border-subtle last:border-0">
                  <div className="w-28 shrink-0">
                    <span className={cls + " text-content"}>Aa</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-muted">{label}</span>
                    <span className="text-[10px] text-faint ml-2">{use}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-4 rounded-lg bg-surface-2 border border-border">
              <p className="text-sm text-content">Body text uses <code className="text-xs text-accent">--font-sans</code>. Mono uses <code className="text-xs text-accent">--font-mono</code>.</p>
              <code className="block text-xs text-muted mt-2 font-mono">const x = await scanSkills();</code>
            </div>
          </Section>

          {/* Buttons */}
          <Section title="Buttons" desc="4 variants x 2 sizes. Anatomy: [icon] Label. Icon = 14px.">
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button className="btn btn-primary"><Plus size={14} /> Primary</button>
                <button className="btn btn-outline"><Download size={14} /> Outline</button>
                <button className="btn btn-ghost"><Edit3 size={14} /> Ghost</button>
                <button className="btn btn-danger"><Trash2 size={14} /> Danger</button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button className="btn btn-primary btn-sm"><Save size={14} /> Small</button>
                <button className="btn btn-outline btn-sm">Small</button>
                <button className="btn btn-ghost btn-sm">Small</button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button className="btn-icon" title="icon"><RefreshCw size={14} /></button>
                <button className="btn-icon" title="icon"><Copy size={14} /></button>
                <button className="btn-icon" title="icon"><Settings size={14} /></button>
                <button className="btn-icon btn-icon-danger" title="delete"><Trash2 size={14} /></button>
                <button className="btn-icon btn-icon-sm" title="small icon"><X size={12} /></button>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn btn-primary" disabled>Disabled</button>
                <button className="btn btn-outline" disabled>Disabled</button>
              </div>
            </div>
          </Section>

          {/* Icons */}
          <Section title="Icon System" desc="Lucide icons. Stroke 2px. Six sizes on a 4px grid.">
            <div className="flex items-end gap-6 flex-wrap">
              {iconSizes.map(([name, size]) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-surface-2 border border-border">
                    <Box size={size} className="text-accent" />
                  </div>
                  <span className="text-[10px] font-mono text-muted">{name} . {size}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-6 flex-wrap">
              <Cpu size={17} className="text-content" /><BookOpen size={17} className="text-content" />
              <Server size={17} className="text-content" /><FileOutput size={17} className="text-content" />
              <FolderOpen size={17} className="text-content" /><Search size={17} className="text-content" />
              <Check size={17} className="text-success" /><X size={17} className="text-danger" />
            </div>
          </Section>

          {/* Form Controls */}
          <Section title="Form Controls" desc=".input class. Border on focus shifts to --c-border-strong.">
            <div className="grid grid-cols-2 gap-4 max-w-lg">
              <input className="input" placeholder="Search..." />
              <input className="input input-mono" placeholder="/path/to/dir" />
              <input className="input" defaultValue="focused state" autoFocus />
              <input className="input" placeholder="disabled" disabled />
            </div>
            <div className="mt-4 max-w-lg">
              <textarea className="input h-24 resize-none" placeholder="Multi-line text..." />
            </div>
          </Section>

          {/* Cards & Badges */}
          <Section title="Cards & Badges" desc=".card = rounded-xl + border + surface bg. .badge = compact pill.">
            <div className="grid grid-cols-2 gap-4">
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-heading">Skill Card</h3>
                <p className="text-xs text-muted mt-1">Rounded-xl, border, surface background.</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="badge text-white bg-orange-500">claude</span>
                  <span className="badge text-white bg-green-600">codex</span>
                  <span className="badge text-violet-600 bg-violet-50 dark:bg-violet-900/30">tag</span>
                </div>
              </div>
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-heading">Status Badges</h3>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="badge text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400">enabled</span>
                  <span className="badge text-faint bg-surface-2">disabled</span>
                  <span className="badge text-blue-500 bg-blue-50 dark:bg-blue-900/30">info</span>
                  <span className="badge text-red-500 bg-red-50 dark:bg-red-900/30">error</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Radius & Shadow */}
          <Section title="Radius & Elevation" desc="Radius scale from 4px to 16px. Five shadow levels for depth.">
            <div className="flex items-end gap-4 flex-wrap mb-6">
              {radii.map(([name, val]) => (
                <div key={name} className="flex flex-col items-center gap-1">
                  <div className="w-16 h-16 bg-accent" style={{ borderRadius: val }} />
                  <span className="text-[10px] font-mono text-muted">{name} . {val}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-6 flex-wrap">
              {shadows.map(([name, cls]) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div className={"w-20 h-12 rounded-lg bg-surface border border-border " + cls} />
                  <span className="text-[10px] font-mono text-muted">{name}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Spacing */}
          <Section title="Spacing Scale" desc="4px base unit. Everything sits on this grid.">
            <div className="space-y-2">
              {[4, 8, 12, 16, 24, 32].map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-muted w-12 shrink-0">{n}px</span>
                  <div className="h-3 bg-accent rounded-sm" style={{ width: n }} />
                </div>
              ))}
            </div>
         </Section>

        </div>
        </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-heading">{title}</h2>
        {desc && <p className="text-xs text-muted mt-1">{desc}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SemanticToken({ label, varName }: { label: string; varName: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-2 border border-border">
      <span className="w-5 h-5 rounded shrink-0 border border-border" style={{ background: `rgb(var(${varName}))` }} />
      <code className="text-[10px] font-mono text-muted truncate">{label}</code>
    </div>
  );
}
