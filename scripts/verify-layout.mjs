import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tauriConfig = JSON.parse(read("../src-tauri/tauri.conf.json"));
const capabilities = JSON.parse(read("../src-tauri/capabilities/default.json"));
const app = read("../src/App.tsx");
const skillsStore = read("../src/stores/skills.ts");
const tauriWrapper = read("../src/lib/tauri.ts");
const rustLib = read("../src-tauri/src/lib.rs");
const skills = read("../src/views/SkillsView.tsx");
const connectionDialog = read("../src/components/ConnectionConfirmationDialog.tsx");
const skillDeleteDialog = read("../src/components/SkillDeleteDialog.tsx");
const styles = read("../src/styles.css");
const pageHeader = read("../src/components/PageHeader.tsx");

const mainWindow = tauriConfig.app.windows.find((window) => window.title === "SkillDeck");
assert.ok(mainWindow, "main Tauri window must be configured");
assert.equal(mainWindow.decorations, true, "macOS overlay controls require decorations to stay enabled");
assert.equal(mainWindow.titleBarStyle, "Overlay", "main window must use the macOS overlay title bar");
assert.equal(mainWindow.hiddenTitle, true, "main window must not draw a separate title strip");
assert.ok(
  mainWindow.trafficLightPosition &&
    typeof mainWindow.trafficLightPosition.y === "number",
  "the macOS traffic lights must be positioned to stay vertically centered in the workspace toolbar",
);
assert.ok(
  capabilities.windows.includes("main") &&
    capabilities.permissions.includes("core:window:allow-start-dragging"),
  "the overlay drag region must be allowed to invoke start_dragging",
);

assert.match(app, /data-testid="primary-sidebar"/, "primary navigation must expose a drawer test id");
assert.match(
  app,
  /key: "market", label: t\("nav\.market"\)/,
  "the marketplace entry must stay in primary navigation",
);
assert.match(rustLib, /marketplace::sync_marketplace,/, "marketplace sync command must stay registered");
assert.match(
  tauriWrapper,
  /invoke<MarketplaceCatalog>\("sync_marketplace", \{ input \}\)/,
  "marketplace sync must keep its typed frontend wrapper",
);
assert.match(app, /data-tauri-drag-region/, "overlay window must retain a drag region");
assert.doesNotMatch(app, /h-9 border-b border-border/, "global white title strip must be removed");
assert.match(app, /navExpanded/, "primary navigation drawer must be collapsible");
assert.doesNotMatch(app, /data-testid="workspace-toolbar"/, "the flat workspace toolbar band must stay removed (V6 floating page bar)");
assert.match(
  pageHeader,
  /className="page-header" data-tauri-drag-region="deep"/,
  "the floating page bar must drag the overlay window in its empty areas",
);
assert.match(app, /data-testid="left-drawer-toggle"/, "left drawer control must exist");
assert.ok(
  app.indexOf('data-testid="left-drawer-toggle"') < app.indexOf("sidebar-footer"),
  "the collapse toggle must sit next to the brand row, not in the footer",
);
assert.doesNotMatch(app, /data-testid="global-scan-toggle"/, "global scanning must not live in the sidebar shell (V6: it belongs to the Overview page bar)");
assert.match(read("../src/views/DashboardView.tsx"), /data-testid="global-scan-toggle"/, "global scanning must live on the Overview page bar");
assert.match(app, /data-testid="theme-toggle"/, "theme quick switch must live in the sidebar footer");
assert.doesNotMatch(app, /right-drawer-toggle/, "the shell must not render a right drawer toggle");

const footerSource = app.slice(
  app.indexOf('className="sidebar-footer"'),
  app.indexOf('className="sidebar-footer"') + 1200,
);
assert.ok(
  footerSource.includes("<ThemeSwitcher") && footerSource.includes('t("nav.settings")'),
  "the theme switch must share the footer settings row (replacing the version number)",
);
assert.doesNotMatch(footerSource, /appVersion/, "the footer settings row must not render the version number");

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
assert.match(app, /function Sidebar[\s\S]*?ThemeSwitcher/, "theme quick switch must live with the sidebar footer controls (V6)");
assert.match(app, /onToggleNav/, "the sidebar footer must own primary navigation toggling");
assert.doesNotMatch(app, /onToggleExpanded/, "primary navigation must not have a duplicate sidebar toggle");
assert.doesNotMatch(app, /leftDrawerOpen/, "the Skills filter drawer must not use the primary navigation control");
assert.doesNotMatch(`${app}${styles}`, /app-sidebar-header/, "the standalone sidebar header must be removed");
assert.ok(
  app.indexOf('className="app-sidebar-nav"') < app.indexOf('className="app-sidebar-brand"'),
  "the logo must be the first item inside the sidebar navigation",
);

assert.doesNotMatch(skills, /skills-left-drawer/, "the Skills left rail must stay removed (V6: dropdown filter in the toolbar)");
assert.match(skills, /setRailFilter/, "Skills must keep tag/library filtering state");
assert.match(skills, /optgroup label="标签聚类"/, "the Skills filter dropdown must group tag clusters");
assert.match(skills, /<ViewToggle mode=\{viewMode\}/, "Skills must offer the V6 grid/list view switch");

assert.doesNotMatch(skillsStore, /window\.confirm/, "Tauri WebView cannot rely on native confirm dialogs");
assert.match(skillsStore, /connectionConfirmation/, "shared disconnect must use application confirmation state");
assert.match(connectionDialog, /data-testid="shared-disconnect-dialog"/, "shared disconnect confirmation must render an in-app dialog");
assert.match(app, /<ConnectionConfirmationDialog/, "the shared disconnect dialog must be mounted by the app shell");
assert.doesNotMatch(skills, /confirmDelete/, "skill deletion must not use local inline confirmation state");
assert.match(skillsStore, /skillDeleteConfirmation/, "skill deletion must use explicit pending confirmation state");
assert.match(app, /<SkillDeleteDialog/, "skill deletion must render an in-app confirmation dialog");
assert.match(skillDeleteDialog, /data-testid="skill-delete-dialog"/, "skill deletion confirmation must expose a dialog test id");
assert.match(skills, /testId="skill-detail-drawer"/, "Skills detail drawer must expose a test id");
assert.doesNotMatch(skills, /data-left-open/, "Skills must not carry legacy left-drawer state");
assert.equal(skills.match(/<SkillDetail\s*\/>/g)?.length, 1, "Skill detail must render exactly once");
assert.ok(
  skills.indexOf("<SkillDetail />") > skills.indexOf('testId="skill-detail-drawer"'),
  "Skill detail must render inside the shared detail drawer",
);
assert.match(skills, /open=\{!!selectedSkill\}/, "selecting a skill must open the detail drawer");
assert.match(skills, /onClose=\{\(\) => selectSkill\(null\)\}/, "closing the detail drawer must clear the selected skill");
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

assert.doesNotMatch(styles, /\.skill-layout/, "the Skills grid layout (left drawer track) must stay removed");
assert.match(styles, /--width-sidebar-collapsed:\s*64px/, "collapsed primary sidebar must be 64px wide");
assert.doesNotMatch(
  styles,
  /\.app-sidebar-nav-top\s*\{[^}]*border-bottom/,
  "the sidebar brand row must not have a bottom divider",
);
assert.match(app, /import SkillsView from "\.\/views\/SkillsView";/, "SkillsView must be mounted by the app shell");
assert.doesNotMatch(app, /SkillsRightDrawer/, "the inline Skills right drawer must be removed");
assert.doesNotMatch(app, /rightDrawerOpen/, "the app must not own skill drawer layout state");
assert.match(skills, /import DetailDrawer from "\.\.\/components\/DetailDrawer";/, "SkillsView must use the shared detail drawer");
assert.doesNotMatch(styles, /\.app-shell\s*\{[^}]*flex-direction:\s*column/, "the shell must be a left-right layout: full-height sidebar on the left, floating page bar inside the main column");
assert.match(
  app,
  /<Sidebar[\s\S]*?<main className="app-main">/,
  "the full-height sidebar must render before the main column",
);
assert.match(styles, /\.workspace-body\s*\{[^}]*display:\s*flex/, "the sidebar and central workspace must share the main area");
assert.match(styles, /\.page-header\s*\{[^}]*border-radius:\s*10px/, "the floating page bar must be a rounded pill (V6)");
assert.match(styles, /\.page-header\s*\{[^}]*var\(--height-page-bar\)/, "the floating page bar height must use a layout token");
assert.match(styles, /\.page-header\s*\{[^}]*var\(--mat-glass-bg\)/, "the floating page bar must use the glass material");
assert.match(styles, /\.page-content-title\s*\{/, "collection pages must have a content-area title class");
assert.match(
  styles,
  /\.app-sidebar-nav-top\s*\{[^}]*min-height:\s*64px/,
  "the sidebar brand strip must clear the macOS traffic lights",
);
assert.match(
  styles,
  /\.app-sidebar-nav-top\s*\{[^}]*padding:\s*36px/,
  "the sidebar brand strip must be pushed below the macOS traffic lights",
);
assert.match(styles, /\.detail-drawer\s*\{[^}]*height:\s*100%/, "the shared detail drawer must occupy the full workspace height");
assert.match(styles, /\.seg\s*\{/, "the V6 segmented control must be a shared component class");
assert.match(styles, /\.card-selected\s*\{/, "grid card selection must use a shared ring class");
assert.doesNotMatch(styles, /\.rail-item/, "rail item classes must stay removed with the Skills left rail");

for (const className of [
  ".page-header",
  ".page-header__spacer",
  ".app-sidebar",
  ".sidebar-item",
]) {
  const classPattern = new RegExp(`${className.replace(".", "\\.")}\\s*\\{`);
  assert.ok(
    classPattern.test(styles) || styles.includes(`${className},`),
    `${className} must be a token-driven component class`,
  );
}
assert.match(styles, /\.sidebar-item\s*\{[^}]*var\(--text-2xs\)/, "sidebar typography must use a type token");
assert.match(styles, /\.sidebar-item\s*\{[^}]*var\(--space-[0-9]+\)/, "sidebar spacing must use the spacing scale");
assert.match(skills, /skills-toolbar-label/, "Skills toolbar labels must be collapsible in a narrow center column");
assert.doesNotMatch(skills, /gridTemplateColumns/, "list rows must use the shared V1 row class, not inline grid definitions");
assert.doesNotMatch(skills, /skills-table-(grid|header)/, "the legacy skills table must stay replaced by V1 list rows");
assert.match(skills, /list-row--skill/, "the Skills list must use the V1 five-column row (name/desc/dots/audit/chevron)");
assert.match(skills, /list-row__name/, "skill names must opt into shrinking inside the V1 row");
assert.match(styles, /\.list-panel\s*\{/, "row collections must live inside the shared V1 list panel");
assert.match(styles, /\.list-row\s*\{[^}]*min-height:\s*46px/, "V1 list rows must keep the 46px row height");
assert.match(
  styles,
  /\.list-row--skill\s*\{[^}]*grid-template-columns:\s*minmax\(150px, 220px\) minmax\(0, 1fr\) auto auto 14px;/,
  "the Skills V1 row must keep its five-track grid",
);
assert.match(styles, /\.skills-toolbar\s*\{[^}]*container-type:\s*inline-size/, "Skills toolbar must measure its own center-column width");
assert.match(
  styles,
  /@container[^{]*max-width[^{]*\{[\s\S]*?\.skills-toolbar-label\s*\{\s*display:\s*none;/,
  "narrow Skills toolbar must hide action labels before overflow can occur",
);
const componentSources = readdirSync(new URL("../src/components", import.meta.url))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => read(`../src/components/${name}`))
  .join("");
assert.doesNotMatch(`${app}${skills}${styles}${componentSources}`, /text-\[(?:11|12|13)px\]/, "arbitrary 11, 12, and 13px font sizes must be replaced by type tokens");

console.log("Layout and Tauri window contract checks passed");
