import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tauriConfig = JSON.parse(read("../src-tauri/tauri.conf.json"));
const capabilities = JSON.parse(read("../src-tauri/capabilities/default.json"));
const app = read("../src/App.tsx");
const appStore = read("../src/stores/app.ts");
const skills = read("../src/views/SkillsView.tsx");
const connectionDialog = read("../src/components/ConnectionConfirmationDialog.tsx");
const skillDeleteDialog = read("../src/components/SkillDeleteDialog.tsx");
const styles = read("../src/styles.css");

const mainWindow = tauriConfig.app.windows.find((window) => window.title === "SkillDeck");
assert.ok(mainWindow, "main Tauri window must be configured");
assert.equal(mainWindow.decorations, true, "macOS overlay controls require decorations to stay enabled");
assert.equal(mainWindow.titleBarStyle, "Overlay", "main window must use the macOS overlay title bar");
assert.equal(mainWindow.hiddenTitle, true, "main window must not draw a separate title strip");
assert.ok(
  capabilities.windows.includes("main") &&
    capabilities.permissions.includes("core:window:allow-start-dragging"),
  "the overlay drag region must be allowed to invoke start_dragging",
);

assert.match(app, /data-testid="primary-sidebar"/, "primary navigation must expose a drawer test id");
assert.match(app, /data-tauri-drag-region/, "overlay window must retain a drag region");
assert.doesNotMatch(app, /h-9 border-b border-border/, "global white title strip must be removed");
assert.match(app, /navExpanded/, "primary navigation drawer must be collapsible");
assert.match(app, /data-testid="workspace-toolbar"/, "central content must have a workspace toolbar");
assert.match(
  app,
  /<header[^>]*data-testid="workspace-toolbar"[^>]*data-tauri-drag-region="deep"/,
  "empty areas throughout the workspace toolbar must drag the overlay window",
);
assert.match(app, /data-testid="left-drawer-toggle"/, "left drawer control must live in the workspace toolbar");
assert.match(app, /data-testid="global-scan-toggle"/, "global scanning must live in the workspace toolbar");
assert.match(app, /data-testid="theme-toggle"/, "theme quick switch must live in the workspace toolbar");
assert.match(app, /data-testid="right-drawer-toggle"/, "right drawer control must live in the workspace toolbar");

const toolbarSource = app.slice(
  app.indexOf('data-testid="workspace-toolbar"'),
  app.indexOf('data-testid="workspace-toolbar"') + 2500,
);
assert.ok(toolbarSource.includes('data-testid="left-drawer-toggle"'), "left drawer control must be in the toolbar's left group");
assert.ok(
  toolbarSource.indexOf('data-testid="global-scan-toggle"') >= 0 &&
  toolbarSource.indexOf('data-testid="global-scan-toggle"') < toolbarSource.indexOf("<ThemeSwitcher") &&
  toolbarSource.indexOf("<ThemeSwitcher") >= 0 &&
  toolbarSource.indexOf("<ThemeSwitcher") < toolbarSource.indexOf('data-testid="right-drawer-toggle"'),
  "global scanning must immediately precede the theme switch, followed by the right drawer control",
);

const scanableViews = [
  "../src/views/DashboardView.tsx",
  "../src/views/SkillsView.tsx",
  "../src/views/RulesView.tsx",
  "../src/views/MCPView.tsx",
  "../src/views/PluginsView.tsx",
  "../src/views/HooksView.tsx",
  "../src/views/ProjectsView.tsx",
  "../src/views/SettingsView.tsx",
].map((path) => read(path));
for (const viewSource of scanableViews) {
  assert.doesNotMatch(
    viewSource,
    /(?:onClick=\{(?:\(\) => )?scanNow\(\)|onClick=\{handleScan\})/,
    "resource views must not render local scan actions",
  );
}
assert.doesNotMatch(read("../src/views/SettingsView.tsx"), /settings\.syncScan/, "Settings must not expose a separate scan action");
assert.doesNotMatch(app, /function Sidebar\([\s\S]*?ThemeSwitcher/, "theme switching must not be owned by the primary sidebar");
assert.match(app, /onToggleNav/, "the top-left workspace control must own primary navigation toggling");
assert.doesNotMatch(app, /onToggleExpanded/, "primary navigation must not have a duplicate sidebar toggle");
assert.doesNotMatch(app, /(?:收起|展开)导航/, "primary navigation toggling must not render sidebar-internal controls");
assert.doesNotMatch(app, /leftDrawerOpen/, "the Skills filter drawer must not use the primary navigation control");
assert.doesNotMatch(`${app}${styles}`, /app-sidebar-header/, "the standalone sidebar header must be removed");
assert.ok(
  app.indexOf('className="app-sidebar-nav"') < app.indexOf('className="app-sidebar-brand"'),
  "the logo must be the first item inside the sidebar navigation",
);

assert.match(skills, /data-testid="skills-left-drawer"/, "Skills left drawer must expose a test id");

assert.doesNotMatch(appStore, /window\.confirm/, "Tauri WebView cannot rely on native confirm dialogs");
assert.match(appStore, /connectionConfirmation/, "shared disconnect must use application confirmation state");
assert.match(connectionDialog, /data-testid="shared-disconnect-dialog"/, "shared disconnect confirmation must render an in-app dialog");
assert.match(app, /<ConnectionConfirmationDialog/, "the shared disconnect dialog must be mounted by the app shell");
assert.doesNotMatch(skills, /confirmDelete/, "skill deletion must not use local inline confirmation state");
assert.match(appStore, /skillDeleteConfirmation/, "skill deletion must use explicit pending confirmation state");
assert.match(app, /<SkillDeleteDialog/, "skill deletion must render an in-app confirmation dialog");
assert.match(skillDeleteDialog, /data-testid="skill-delete-dialog"/, "skill deletion confirmation must expose a dialog test id");
assert.match(skills, /data-testid="skills-right-drawer"/, "Skills right drawer must expose a test id");
assert.match(skills, /data-left-open/, "Skills left drawer state must be explicit");
assert.equal(skills.match(/<SkillDetail\s*\/>/g)?.length, 1, "Skill detail must render exactly once");
assert.ok(
  skills.indexOf("<SkillDetail />") > skills.indexOf('data-testid="skills-right-drawer"'),
  "Skill detail must render inside the right drawer",
);
assert.match(
  app,
  /selectedSkillId[\s\S]*setRightDrawerOpen\(true\)/,
  "selecting a skill must open the right detail drawer",
);
assert.match(
  skills,
  /data-testid="connection-path-button"[\s\S]*revealInFinder\(connection\.entry_path\)/,
  "Skill connection paths must render on their own clickable row",
);
assert.doesNotMatch(
  skills,
  /connection\.entry_path\s*:\s*"未接线"/,
  "the connection path row must not be compressed into the agent label row",
);
assert.match(
  skills,
  /data-testid="batch-disconnect-agent"[\s\S]*getDisconnectableSkillIds[\s\S]*batchConnect\(\[\], disconnectIds, agentId\)/,
  "batch operations must provide agent-scoped disconnect and filter connected skills",
);
assert.match(
  skills,
  /formatSkillPath\(connection\.entry_path, homeDirectory\)/,
  "connection paths must display home paths with a tilde while retaining the absolute path",
);
assert.match(
  skills,
  /buildBatchSharedDisconnectConfirmation[\s\S]*requestBatchSharedDisconnect/,
  "batch disconnect must convert shared-link errors into a confirmation dialog",
);

assert.match(styles, /\.skill-layout--left-closed/, "closed Skills left drawer must remove its grid track");
assert.match(styles, /--width-sidebar-collapsed:\s*64px/, "collapsed primary sidebar must be 64px wide");
assert.doesNotMatch(
  styles,
  /\.app-sidebar-nav-top\s*\{[^}]*border-bottom/,
  "the sidebar brand row must not have a bottom divider",
);
assert.match(app, /import SkillsView, \{ SkillsRightDrawer \} from "\.\/views\/SkillsView";/, "the app must own the workspace-level right drawer");
assert.ok(
  app.indexOf("</main>") < app.indexOf("<SkillsRightDrawer"),
  "the Skills right drawer must be a sibling after main.app-main",
);
assert.doesNotMatch(app, /<SkillsView[^>]*rightDrawerOpen/, "SkillsView must not receive workspace right-drawer layout state");
const skillsMainSource = skills.slice(
  skills.indexOf("export default function SkillsView"),
  skills.indexOf("export function SkillsRightDrawer"),
);
assert.doesNotMatch(skillsMainSource, /skills-right-drawer/, "the Skills right drawer must not render inside main.app-main");
assert.match(styles, /\.app-shell\s*\{[^}]*flex-direction:\s*column/, "the full-width workspace toolbar must sit above the drawer body");
assert.match(styles, /\.workspace-body\s*\{[^}]*display:\s*flex/, "the sidebar and central workspace must share the area below the toolbar");
assert.match(styles, /\.workspace-toolbar\s*\{[^}]*width:\s*100%/, "workspace toolbar must occupy the full workspace width");
assert.match(
  styles,
  /\.workspace-toolbar\s*\{[^}]*padding-left:\s*var\(--offset-macos-traffic-lights\)/,
  "the full-width toolbar must reserve space for macOS traffic lights",
);
assert.match(styles, /\.skills-right-drawer\s*\{[^}]*height:\s*100%/, "Skills right drawer must occupy the full workspace height");
assert.match(
  styles,
  /\.skill-layout\s*\{[^}]*grid-template-columns:\s*var\(--width-left-drawer\) minmax\(0, 1fr\)/,
  "the Skills center layout must contain only its filter drawer and center column",
);
assert.match(
  styles,
  /\.skill-layout--left-closed\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
  "closing the Skills filter drawer must leave only the center column",
);
assert.doesNotMatch(styles, /\.skill-layout--right-closed/, "right-drawer opening state must not alter the center grid");

for (const className of [
  ".workspace-toolbar",
  ".workspace-toolbar-left",
  ".workspace-toolbar-right",
  ".app-sidebar",
  ".sidebar-item",
]) {
  const classPattern = new RegExp(`${className.replace(".", "\\.")}\\s*\\{`);
  assert.ok(
    classPattern.test(styles) || styles.includes(`${className},`),
    `${className} must be a token-driven component class`,
  );
}
assert.match(styles, /\.workspace-toolbar\s*\{[^}]*var\(--height-workspace-toolbar\)/, "workspace toolbar height must use a layout token");
assert.match(styles, /\.sidebar-item\s*\{[^}]*var\(--text-xs\)/, "sidebar typography must use a type token");
assert.match(styles, /\.sidebar-item\s*\{[^}]*var\(--space-[0-9]+\)/, "sidebar spacing must use the spacing scale");
assert.match(skills, /skills-toolbar-label/, "Skills toolbar labels must be collapsible in a narrow center column");
assert.doesNotMatch(skills, /gridTemplateColumns/, "table rows and headers must share the token-driven grid definition");
assert.equal((skills.match(/skills-table-grid/g) ?? []).length, 2, "table rows and headers must use the shared grid class");
assert.match(skills, /className="min-w-0 truncate text-sm font-semibold text-heading"/, "skill names must opt into shrinking inside their grid track");
assert.match(styles, /\.skills-toolbar\s*\{[^}]*container-type:\s*inline-size/, "Skills toolbar must measure its own center-column width");
assert.match(
  styles,
  /\.skills-table-grid\s*\{[^}]*grid-template-columns:\s*minmax\(var\(--width-skill-name-min\), clamp\(var\(--width-skill-name-min\), var\(--width-skill-name-flex\), var\(--width-skill-name-max\)\)\)[\s\S]*?minmax\(var\(--width-skill-agents\), 1fr\)[\s\S]*?minmax\(var\(--width-skill-permissions\), var\(--width-skill-permissions-max\)\)[\s\S]*?minmax\(var\(--width-skill-audit\), var\(--width-skill-audit-max\)\)[\s\S]*?minmax\(var\(--width-skill-state\), var\(--width-skill-state-max\)\);/,
  "Skills metadata columns must expand up to their content-based maximum widths",
);
assert.match(
  styles,
  /@container[^{]*max-width[^{]*\{[\s\S]*?\.skills-toolbar-label\s*\{\s*display:\s*none;/,
  "narrow Skills toolbar must hide action labels before overflow can occur",
);
const componentSources = readdirSync(new URL("../src/components", import.meta.url))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => read(`../src/components/${name}`))
  .join("");
assert.doesNotMatch(`${app}${skills}${styles}${componentSources}`, /text-\[(?:9|10|11)px\]/, "arbitrary 9, 10, and 11px font sizes must be replaced by type tokens");

console.log("Layout and Tauri window contract checks passed");
