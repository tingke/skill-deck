import { useEffect, useState } from "react";
import { useUiStore } from "./stores/ui";
import { useSkillsStore } from "./stores/skills";
import { useAssetsStore } from "./stores/assets";
import { useExtensionsStore } from "./stores/extensions";
import { useWorkspaceStore } from "./stores/workspace";
import { usePackagesStore } from "./stores/packages";
import { useActivityStore } from "./stores/activity";
import DashboardView from "./views/DashboardView";
import SkillsView from "./views/SkillsView";
import MarketView from "./views/MarketView";
import AuditView from "./views/AuditView";
import PackagesView from "./views/PackagesView";
import MCPView from "./views/MCPView";
import PluginsView from "./views/PluginsView";
import HooksView from "./views/HooksView";
import PromptsView from "./views/PromptsView";
import RulesView from "./views/RulesView";
import SettingsView from "./views/SettingsView";
import AgentsView from "./views/AgentsView";
import ProjectsView from "./views/ProjectsView";
import DesignSystemView from "./views/DesignSystemView";
import ToastContainer from "./components/Toast";
import AgentActivityNotifier from "./components/AgentActivityNotifier";
import ConnectionConfirmationDialog from "./components/ConnectionConfirmationDialog";
import SkillDeleteDialog from "./components/SkillDeleteDialog";
import { LayoutDashboard, FileText, ScrollText, Settings as SettingsIcon, BookOpen, Plug, Layers, Webhook, Server, Sun, Moon, FolderKanban, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { Cpu } from "lucide-react";
import logoUrl from "./assets/logo.png";
import type { ViewKey } from "./types";
import { useT } from "./i18n";

export default function App() {
  const { view, setView } = useUiStore();
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const globalScan = useSkillsStore((s) => s.globalScan);
  const globalScanning = useSkillsStore((s) => s.globalScanning);
  const connectionConfirmation = useSkillsStore((s) => s.connectionConfirmation);
  const connectionConfirming = useSkillsStore((s) => s.connectionConfirming);
  const cancelSharedDisconnect = useSkillsStore((s) => s.cancelSharedDisconnect);
  const confirmSharedDisconnect = useSkillsStore((s) => s.confirmSharedDisconnect);
  const skillDeleteConfirmation = useSkillsStore((s) => s.skillDeleteConfirmation);
  const skillDeleting = useSkillsStore((s) => s.skillDeleting);
  const cancelSkillDelete = useSkillsStore((s) => s.cancelSkillDelete);
  const confirmSkillDelete = useSkillsStore((s) => s.confirmSkillDelete);
  const [navExpanded, setNavExpanded] = useState(() => window.innerWidth >= 1100);

  useEffect(() => {
    // WKWebView can enable sentence capitalization and text correction for text fields.
    // Disable both when a field receives focus so technical names/paths stay as typed.
    const disableAutomaticTextTransforms = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

      target.autocapitalize = "none";
      target.setAttribute("autocorrect", "off");
      target.spellcheck = false;
    };

    document.addEventListener("focusin", disableAutomaticTextTransforms, true);
    return () => document.removeEventListener("focusin", disableAutomaticTextTransforms, true);
  }, []);

  useEffect(() => {
    const disableDefaultContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", disableDefaultContextMenu);
    return () => document.removeEventListener("contextmenu", disableDefaultContextMenu);
  }, []);

  useEffect(() => {
    (async () => {
      await useSkillsStore.getState().bootstrapScan();
      await useSkillsStore.getState().loadAgentOptions();
      await useSkillsStore.getState().verifyConnections();
      await loadSkills();
      await useAssetsStore.getState().loadPrompts();
      await useAssetsStore.getState().loadRules();
      await useActivityStore.getState().loadActivity();
      await usePackagesStore.getState().loadPackages();
      await useExtensionsStore.getState().loadExtensions();
      await useWorkspaceStore.getState().loadAgents();
      await useWorkspaceStore.getState().loadProjects();
      await useWorkspaceStore.getState().loadLibrarySources();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    const apply = (t: "light" | "dark") => {
      if (t === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
    };
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      apply(theme);
    }
  }, [theme]);

  const views: Record<ViewKey, React.ReactNode> = {
    dashboard: <DashboardView />,
    market: <MarketView />,
    skills: <SkillsView />,
    audit: <AuditView />,
    presets: <PackagesView />,
    prompts: <PromptsView />,
    rules: <RulesView />,
   agents: <AgentsView />,
   projects: <ProjectsView />,
    mcp: <MCPView />,
    plugins: <PluginsView />,
    hooks: <HooksView />,
    settings: <SettingsView />,
    design: <DesignSystemView />,
  };

  return (
    <div className="app-shell">
      <div className="workspace-body">
        <Sidebar
          view={view}
          onChange={setView}
          expanded={navExpanded}
          onToggleNav={() => setNavExpanded((expanded) => !expanded)}
          theme={theme}
          onThemeChange={setTheme}
        />
        <main className="app-main">
          <div className="workspace-content">{views[view]}</div>
        </main>
      </div>
      <ConnectionConfirmationDialog
        confirmation={connectionConfirmation}
        confirming={connectionConfirming}
        onCancel={cancelSharedDisconnect}
        onConfirm={confirmSharedDisconnect}
      />
      <SkillDeleteDialog
        confirmation={skillDeleteConfirmation}
        deleting={skillDeleting}
        onCancel={cancelSkillDelete}
        onConfirm={confirmSkillDelete}
      />
      <AgentActivityNotifier />
      <ToastContainer />
    </div>
  );
}

function ComingSoon({ name }: { name: string }) {
  const t = useT();
  return (
    <div className="flex-1 flex items-center justify-center text-muted">
      <div className="text-center">
        <p className="text-lg">{name}</p>
        <p className="text-sm mt-1">{t("common.comingSoon")}</p>
      </div>
    </div>
  );
}

function ThemeSwitcher({ theme, onChange }: { theme: string; onChange: (t: "light" | "dark" | "system") => void }) {
  const t = useT();
  // 标题栏只在浅色 / 深色间切换；「跟随系统」保留在设置页。
  // 跟随系统时按系统当前偏好解析出实际模式：图标显示实际模式，
  // 且点击总是切到"与当前所见相反"的模式
  const cycle: { id: "light" | "dark"; icon: React.ReactNode; label: string }[] = [
    { id: "light", icon: <Sun size={14} />, label: t("settings.light") },
    { id: "dark", icon: <Moon size={14} />, label: t("settings.dark") },
  ];
  const systemDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const cur = cycle.find((c) => c.id === resolved) || cycle[0];
  const nextIdx = (cycle.findIndex((c) => c.id === resolved) + 1) % cycle.length;
  return (
    <button
      data-testid="theme-toggle"
      onClick={() => onChange(cycle[nextIdx].id)}
      title={`切换主题：${cur.label}`}
      aria-label={`切换主题，当前为${cur.label}`}
      className="btn-icon"
    >
      {cur.icon}
    </button>
  );
}


function Sidebar({
  view,
  onChange,
  expanded,
  onToggleNav,
  theme,
  onThemeChange,
}: {
  view: ViewKey;
  onChange: (v: ViewKey) => void;
  expanded: boolean;
  onToggleNav: () => void;
  theme: string;
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}) {
const t = useT();
 const skills = useSkillsStore((s) => s.skills);
 const prompts = useAssetsStore((s) => s.prompts);
 const rules = useAssetsStore((s) => s.rules);
 const packages = usePackagesStore((s) => s.packages);
 const extensions = useExtensionsStore((s) => s.extensions);
 const agents = useWorkspaceStore((s) => s.agents);
 const projects = useWorkspaceStore((s) => s.projects);
const unaudited = skills.filter((s) => !s.audit_verdict).length;
const navGroups: { label?: string; items: { key: ViewKey; label: string; icon: React.ReactNode; badge?: number; badgeTitle?: string }[] }[] = [
  {
    items: [{ key: "dashboard", label: t("nav.dashboard"), icon: <LayoutDashboard size={17} /> }],
  },
  {
    label: t("nav.groupKnowledge"),
    items: [
      { key: "skills", label: t("nav.skills"), icon: <BookOpen size={17} />, badge: skills.length },
      { key: "prompts", label: t("nav.prompts"), icon: <FileText size={17} />, badge: prompts.length },
      { key: "rules", label: t("nav.rules"), icon: <ScrollText size={17} />, badge: rules.length },
    ],
  },
  {
    label: t("nav.groupAgents"),
    items: [
      { key: "agents", label: t("nav.agents"), icon: <Cpu size={17} />, badge: agents.length },
      { key: "mcp", label: t("nav.mcp"), icon: <Server size={17} />, badge: extensions.filter((e) => e.kind === "mcp").length },
      { key: "plugins", label: t("nav.plugins"), icon: <Plug size={17} />, badge: extensions.filter((e) => e.kind === "plugin").length },
      { key: "hooks", label: t("nav.hooks"), icon: <Webhook size={17} />, badge: extensions.filter((e) => e.kind === "hook").length },
    ],
  },
  {
    label: t("nav.groupApply"),
    items: [
      { key: "presets", label: t("nav.presets"), icon: <Layers size={17} />, badge: packages.length },
      { key: "projects", label: t("nav.projects"), icon: <FolderKanban size={17} />, badge: projects.length },
    ],
  },
  {
    label: t("nav.groupDiscover"),
    items: [
      // 商店入口暂时隐藏：技能获取以「技能页 → 自定义安装」为主，MarketView 代码保留可随时恢复
      { key: "audit", label: t("nav.audit"), icon: <ShieldCheck size={17} />, badge: unaudited || undefined, badgeTitle: t("nav.auditBadgeTitle", { count: unaudited }) },
    ],
  },
];

  return (
    <aside
      data-testid="primary-sidebar"
      className={"app-sidebar" + (expanded ? "" : " app-sidebar--collapsed")}
    >
      <nav className="app-sidebar-nav">
        {/* The native macOS traffic lights overlay this drag region. */}
          <div data-tauri-drag-region className="app-sidebar-nav-top">
            <div className="app-sidebar-brand">
            <img src={logoUrl} alt="" className="app-sidebar-logo" />
          </div>
          {expanded && (
            <>
              <span className="app-sidebar-title">SkillDeck</span>
              <button
                data-testid="left-drawer-toggle"
                onClick={onToggleNav}
                className="btn-icon"
                title="收起主侧栏"
                aria-label="收起主侧栏"
                aria-expanded={expanded}
              >
                <PanelLeftClose size={14} />
              </button>
            </>
          )}
          {!expanded && (
            <button
              data-testid="left-drawer-toggle"
              onClick={onToggleNav}
              className="btn-icon"
              title="展开主侧栏"
              aria-label="展开主侧栏"
              aria-expanded={expanded}
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
        </div>
        {navGroups.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} className="sidebar-group">
            {expanded && group.label && <div className="nav-group-label">{group.label}</div>}
            {group.items.map((item) => (
              <button
                key={item.key}
                onClick={() => onChange(item.key)}
                title={item.badgeTitle || item.label}
                aria-current={view === item.key ? "page" : undefined}
                className={
                  "sidebar-item " +
                  (expanded ? "" : "sidebar-item--collapsed ") +
                  (view === item.key ? "sidebar-item--active" : "")
                }
              >
                {item.icon}
                {expanded && <span className="truncate">{item.label}</span>}
                {expanded && item.badge !== undefined && item.badge > 0 && (
                  <span className="sidebar-badge">{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
     <div className="sidebar-footer">
       <div className="flex items-center">
         <button
           onClick={() => onChange("settings")}
           title={t("nav.settings")}
           className={
             "sidebar-item " +
             (expanded ? "" : "sidebar-item--collapsed ") +
             (view === "settings" ? "sidebar-item--active" : "")
           }
         >
           <SettingsIcon size={17} />
           {expanded && <span className="truncate">{t("nav.settings")}</span>}
         </button>
         <div className={expanded ? "ml-auto pr-1" : "w-full flex justify-center pb-1"}>
           <ThemeSwitcher theme={theme} onChange={onThemeChange} />
         </div>
       </div>
    </div>
    </aside>
  );
}
