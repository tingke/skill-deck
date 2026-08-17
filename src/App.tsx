import { useEffect, useState } from "react";
import { useAppStore } from "./stores/app";
import DashboardView from "./views/DashboardView";
import SkillsView, { SkillsRightDrawer } from "./views/SkillsView";
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
import ConnectionConfirmationDialog from "./components/ConnectionConfirmationDialog";
import SkillDeleteDialog from "./components/SkillDeleteDialog";
import { LayoutDashboard, FileText, Settings as SettingsIcon, BookOpen, Plug, Layers, Webhook, Server, Sun, Moon, Monitor, FolderKanban, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import { Cpu } from "lucide-react";
import logoUrl from "./assets/logo.png";
import type { ViewKey } from "./types";
import { useT } from "./i18n";

export default function App() {
  const { view, setView, loadSkills } = useAppStore();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const globalScan = useAppStore((s) => s.globalScan);
  const globalScanning = useAppStore((s) => s.globalScanning);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const connectionConfirmation = useAppStore((s) => s.connectionConfirmation);
  const connectionConfirming = useAppStore((s) => s.connectionConfirming);
  const cancelSharedDisconnect = useAppStore((s) => s.cancelSharedDisconnect);
  const confirmSharedDisconnect = useAppStore((s) => s.confirmSharedDisconnect);
  const skillDeleteConfirmation = useAppStore((s) => s.skillDeleteConfirmation);
  const skillDeleting = useAppStore((s) => s.skillDeleting);
  const cancelSkillDelete = useAppStore((s) => s.cancelSkillDelete);
  const confirmSkillDelete = useAppStore((s) => s.confirmSkillDelete);
  const [navExpanded, setNavExpanded] = useState(() => window.innerWidth >= 1100);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(() => window.innerWidth >= 1200);

  useEffect(() => {
    (async () => {
      await useAppStore.getState().bootstrapScan();
      await useAppStore.getState().loadAgentOptions();
      await useAppStore.getState().verifyConnections();
      await loadSkills();
      await useAppStore.getState().loadPrompts();
      await useAppStore.getState().loadRules();
      await useAppStore.getState().loadActivity();
      await useAppStore.getState().loadPackages();
     await useAppStore.getState().loadExtensions();
     await useAppStore.getState().loadAgents();
     await useAppStore.getState().loadProjects();
      await useAppStore.getState().loadLibrarySources();
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

  useEffect(() => {
    if (selectedSkillId) setRightDrawerOpen(true);
  }, [selectedSkillId]);

  const views: Record<ViewKey, React.ReactNode> = {
    dashboard: <DashboardView />,
    skills: <SkillsView />,
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
      <WorkspaceToolbar
        theme={theme}
        onThemeChange={setTheme}
        scanning={globalScanning}
        onScan={globalScan}
        navExpanded={navExpanded}
        rightDrawerOpen={rightDrawerOpen}
        onToggleNav={() => setNavExpanded((expanded) => !expanded)}
        onToggleRightDrawer={() => setRightDrawerOpen((open) => !open)}
      />
      <div className="workspace-body">
        <Sidebar
          view={view}
          onChange={setView}
          expanded={navExpanded}
        />
        <main className="app-main">
          <div className="workspace-content">{views[view]}</div>
        </main>
        {view === "skills" && <SkillsRightDrawer open={rightDrawerOpen} />}
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

function WorkspaceToolbar({
  theme,
  onThemeChange,
  scanning,
  onScan,
  navExpanded,
  rightDrawerOpen,
  onToggleNav,
  onToggleRightDrawer,
}: {
  theme: string;
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  scanning: boolean;
  onScan: () => void;
  navExpanded: boolean;
  rightDrawerOpen: boolean;
  onToggleNav: () => void;
  onToggleRightDrawer: () => void;
}) {
  const t = useT();
  return (
    <header
      data-testid="workspace-toolbar"
      data-tauri-drag-region="deep"
      className="workspace-toolbar"
    >
      <div className="workspace-toolbar-left">
        <button
          data-testid="left-drawer-toggle"
          onClick={onToggleNav}
          className="btn-icon shrink-0"
          title={navExpanded ? "收起主侧栏" : "展开主侧栏"}
          aria-label={navExpanded ? "收起主侧栏" : "展开主侧栏"}
          aria-expanded={navExpanded}
        >
          {navExpanded ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
      </div>
      <div data-tauri-drag-region className="workspace-toolbar-spacer" />
      <div className="workspace-toolbar-right">
        <button
          data-testid="global-scan-toggle"
          onClick={onScan}
          disabled={scanning}
          className="btn-icon shrink-0"
          title={t("common.globalScan")}
          aria-label={t("common.globalScan")}
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
        </button>
        <ThemeSwitcher theme={theme} onChange={onThemeChange} />
        <button
          data-testid="right-drawer-toggle"
          onClick={onToggleRightDrawer}
          className="btn-icon shrink-0"
          title={rightDrawerOpen ? "收起右侧详情栏" : "展开右侧详情栏"}
          aria-label={rightDrawerOpen ? "收起右侧详情栏" : "展开右侧详情栏"}
          aria-expanded={rightDrawerOpen}
        >
          {rightDrawerOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </div>
    </header>
  );
}

function ThemeSwitcher({ theme, onChange }: { theme: string; onChange: (t: "light" | "dark" | "system") => void }) {
  const t = useT();
  const cycle: { id: "light" | "dark" | "system"; icon: React.ReactNode; label: string }[] = [
    { id: "light", icon: <Sun size={14} />, label: t("settings.light") },
    { id: "dark", icon: <Moon size={14} />, label: t("settings.dark") },
    { id: "system", icon: <Monitor size={14} />, label: t("settings.system") },
  ];
  const cur = cycle.find((c) => c.id === theme) || cycle[0];
  const nextIdx = (cycle.findIndex((c) => c.id === theme) + 1) % cycle.length;
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
}: {
  view: ViewKey;
  onChange: (v: ViewKey) => void;
  expanded: boolean;
}) {
const t = useT();
 const { skills, prompts, rules, packages, extensions, agents, projects } = useAppStore();
const items: { key: ViewKey; label: string; icon: React.ReactNode; badge?: number }[] = [
   { key: "dashboard", label: t("nav.dashboard"), icon: <LayoutDashboard size={17} /> },
   { key: "agents", label: t("nav.agents"), icon: <Cpu size={17} />, badge: agents.length },
   { key: "skills", label: t("nav.skills"), icon: <BookOpen size={17} />, badge: skills.length },
   { key: "rules", label: t("nav.rules"), icon: <FileText size={17} />, badge: rules.length },
   { key: "mcp", label: t("nav.mcp"), icon: <Server size={17} />, badge: extensions.filter((e) => e.kind === "mcp").length },
   { key: "plugins", label: t("nav.plugins"), icon: <Plug size={17} />, badge: extensions.filter((e) => e.kind === "plugin").length },
   { key: "hooks", label: t("nav.hooks"), icon: <Webhook size={17} />, badge: extensions.filter((e) => e.kind === "hook").length },
   { key: "presets", label: t("nav.presets"), icon: <Layers size={17} />, badge: packages.length },
   { key: "projects", label: t("nav.projects"), icon: <FolderKanban size={17} />, badge: projects.length },
   { key: "prompts", label: t("nav.prompts"), icon: <FileText size={17} />, badge: prompts.length },
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
            <span className="app-sidebar-title">SkillDeck</span>
          )}
        </div>
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            title={item.label}
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
      </nav>
     <div className="sidebar-footer">
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
         {expanded && <span className="ml-auto text-2xs font-mono opacity-60">v0.0.1</span>}
     </button>
    </div>
    </aside>
  );
}
