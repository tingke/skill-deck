import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Trash2, Edit3 } from "lucide-react";
import type { ExtensionRow } from "../types";
import { revealInFinder, getHomeDirectory } from "../lib/tauri";
import { formatSkillPath } from "../lib/skillPaths";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import RowMenu from "./RowMenu";
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
      className={"relative w-9 h-5 rounded-full transition-colors shrink-0 " + (checked ? "bg-accent" : "bg-surface-hover")}
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

/// Shared one-line detail for MCP / Hook / Plugin rows & cards.
function extDetail(ext: ExtensionRow): string {
  let cfg: Record<string, string> = {};
  try { cfg = JSON.parse(ext.config_json || "{}"); } catch { /* keep empty */ }
  let detail = ext.description;
  if (ext.kind === "mcp" && cfg.command) detail = cfg.command;
  if (ext.kind === "hook") {
    detail = `${cfg.matcher || "*"} · ${cfg.command.slice(0, 60)}${cfg.command.length > 60 ? "…" : ""}`;
  }
  if (ext.kind === "plugin" && cfg.marketplace) detail = `@${cfg.marketplace}${cfg.version ? " · v" + cfg.version : ""}`;
  return detail;
}

function useExtMenu(ext: ExtensionRow, onDelete: () => void, onEdit?: () => void) {
  const t = useT();
  const deleteConfirmation = useDeleteConfirmation();
  return {
    deleteConfirmation,
    menu: (
      <RowMenu
        ariaLabel={t("ext.more")}
        items={[
          ...(onEdit ? [{ label: t("ext.edit"), icon: <Edit3 size={13} />, onSelect: onEdit }] : []),
          {
            label: t("ext.delete"),
            icon: <Trash2 size={13} />,
            danger: true,
            onSelect: () => deleteConfirmation.request(ext.name, onDelete),
          },
        ]}
      />
    ),
  };
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
  const { deleteConfirmation, menu } = useExtMenu(ext, onDelete, onEdit);
  const rt = ext.runtime;
  const detail = extDetail(ext);

  return (
    <>
    <div className="list-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="list-row__name">{ext.name}</span>
          <span className="badge shrink-0">
            <AgentGlyph id={rt} label={rt} size={12} />
            <span className="ml-1">{rt}</span>
          </span>
          {ext.source === "scan" && ext.kind === "plugin" && !ext.enabled && (
            <span className="badge shrink-0">{t("ext.notConfigured")}</span>
          )}
        </div>
      </div>
      <div className="min-w-0">
        {detail && <p className="text-xs text-muted truncate font-mono">{detail}</p>}
        {kindPath && <PathButton path={kindPath} />}
      </div>
      <ToggleSwitch checked={ext.enabled} onChange={onToggle} />
      {menu}
    </div>
    <DeleteConfirmDialog controller={deleteConfirmation} testId={`delete-${ext.kind}-dialog`} />
    </>
  );
}

/// MCP / Hook / Plugin grid card (网格视图).
export function ExtCard({
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
  const { deleteConfirmation, menu } = useExtMenu(ext, onDelete, onEdit);
  const rt = ext.runtime;
  const detail = extDetail(ext);

  return (
    <>
    <div
      className="card relative p-3.5 flex flex-col gap-2 cursor-pointer card-hover"
      onClick={onEdit}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="list-row__name min-w-0">{ext.name}</span>
        <span className="badge shrink-0 ml-auto">
          <AgentGlyph id={rt} label={rt} size={12} />
          <span className="ml-1">{rt}</span>
        </span>
      </div>
      {detail && <p className="text-2xs text-muted font-mono line-clamp-2 min-h-[28px]">{detail}</p>}
      <div className="flex items-center gap-2 mt-auto pt-0.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        {kindPath && <PathButton path={kindPath} />}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <ToggleSwitch checked={ext.enabled} onChange={onToggle} />
          {menu}
        </div>
      </div>
      {ext.source === "scan" && ext.kind === "plugin" && !ext.enabled && (
        <span className="absolute top-2 right-2 badge">{t("ext.notConfigured")}</span>
      )}
    </div>
    <DeleteConfirmDialog controller={deleteConfirmation} testId={`delete-${ext.kind}-dialog`} />
    </>
  );
}
