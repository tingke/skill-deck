import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Trash2, Edit3 } from "lucide-react";
import type { ExtensionRow } from "../types";
import { revealInFinder, getHomeDirectory } from "../lib/tauri";
import { formatSkillPath } from "../lib/skillPaths";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import { AgentGlyph } from "./AgentGlyph";

const toast = () => useToastStore.getState();

// 模块级缓存：家目录只需向后端查询一次
let cachedHomeDirectory: Promise<string> | null = null;
function loadHomeDirectory(): Promise<string> {
  cachedHomeDirectory ??= getHomeDirectory().catch(() => "");
  return cachedHomeDirectory;
}

export function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={"relative w-9 h-5 rounded-full transition-colors shrink-0 " + (checked ? "bg-emerald-500" : "bg-surface-hover")}
    >
      <span className={"absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform " + (checked ? "translate-x-4" : "")} />
    </button>
  );
}

export function PathButton({ path }: { path: string }) {
  const t = useT();
  const [homeDirectory, setHomeDirectory] = useState("");
  useEffect(() => {
    loadHomeDirectory().then(setHomeDirectory);
  }, []);
  if (!path) return null;
  const short = formatSkillPath(path, homeDirectory);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await revealInFinder(path);
        } catch (err) {
          toast().show(t("ext.openFailed", { msg: String(err) }), "error");
        }
      }}
      title={path}
      className="flex items-center gap-1 text-2xs text-faint hover:text-muted dark:hover:text-faint font-mono max-w-[260px] truncate"
    >
      <FolderOpen size={11} />
      <span className="truncate">{short}</span>
    </button>
  );
}

/// MCP / Hook / Plugin shared row component. kindPath is the config file path (resolved externally).
export function ExtRow({
  ext,
  kindPath,
  onToggle,
  onDelete,
  onEdit,
}: {
  ext: ExtensionRow;
  kindPath?: string;
  onToggle: () => void;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  const t = useT();
  const deleteConfirmation = useDeleteConfirmation();
  const rt = ext.runtime;
  const cfg = useMemo(() => {
    try { return JSON.parse(ext.config_json || "{}"); } catch { return {}; }
  }, [ext.config_json]);

  let detail = ext.description;
  if (ext.kind === "mcp" && cfg.command) detail = cfg.command;
  if (ext.kind === "hook") {
    detail = `${cfg.matcher || "*"} · ${(cfg.command || "").slice(0, 60)}${(cfg.command || "").length > 60 ? "…" : ""}`;
  }
  if (ext.kind === "plugin" && cfg.marketplace) detail = `@${cfg.marketplace}${cfg.version ? " · v" + cfg.version : ""}`;

  return (
    <>
    <div className="flex items-center gap-3 bg-surface rounded-lg border border-border px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content truncate">{ext.name}</span>
          <span className="badge bg-surface-2 text-muted">
            <AgentGlyph id={rt} label={rt} size={14} />
            <span className="ml-1">{rt}</span>
          </span>
          {ext.source === "scan" && ext.kind === "plugin" && !ext.enabled && (
            <span className="badge bg-surface-2 text-faint">{t("ext.notConfigured")}</span>
          )}
          {kindPath && <PathButton path={kindPath} />}
        </div>
        {detail && <p className="text-xs text-muted mt-0.5 truncate font-mono">{detail}</p>}
      </div>
      <ToggleSwitch checked={ext.enabled} onChange={onToggle} />
      {onEdit && (
        <button onClick={onEdit} className="btn-icon" title={t("ext.edit")}>
          <Edit3 size={14} />
        </button>
      )}
      <button
        onClick={() => deleteConfirmation.request(ext.name, onDelete)}
        className="btn-icon btn-icon-danger"
        title={t("ext.delete")}
      >
        <Trash2 size={14} />
      </button>
    </div>
    <DeleteConfirmDialog controller={deleteConfirmation} testId={`delete-${ext.kind}-dialog`} />
    </>
  );
}
