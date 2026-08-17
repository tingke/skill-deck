import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../stores/app";
import { togglePlugin, deleteExt, extConfigPath } from "../lib/tauri";
import { Package as PackageIcon } from "lucide-react";
import type { ExtensionRow } from "../types";
import { ExtRow } from "../components/ExtList";
import { EmptyState } from "./MCPView";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";

const toast = () => useToastStore.getState();

export default function PluginsView() {
  const t = useT();
  const { loadExtensions } = useAppStore();
  const allExtensions = useAppStore((s) => s.extensions);
  const extensions = useMemo(
    () => allExtensions.filter((e) => e.kind === "plugin"),
    [allExtensions],
  );
  const extIds = extensions.map((e) => e.id).join(",");
  const [paths, setPaths] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const ids = extIds.split(",").filter(Boolean);
      const p: Record<string, string> = {};
      for (const id of ids) {
        try { p[id] = await extConfigPath(id); } catch { /* ignore */ }
      }
      setPaths(p);
    })();
  }, [extIds]);

  const handleToggle = async (ext: ExtensionRow) => {
    const next = !ext.enabled;
    useAppStore.setState((s) => ({
      extensions: s.extensions.map((e) => (e.id === ext.id ? { ...e, enabled: next } : e)),
    }));
    try {
      let cfg: { marketplace?: string } = {};
      try { cfg = JSON.parse(ext.config_json || "{}"); } catch { /* ignore */ }
      await togglePlugin({ name: ext.name, marketplace: cfg.marketplace || "", enabled: next });
      toast().show(next ? t("ext.enabled") : t("ext.disabled"), "info");
    } catch (e) {
      useAppStore.setState((s) => ({
        extensions: s.extensions.map((e) => (e.id === ext.id ? { ...e, enabled: !next } : e)),
      }));
      toast().show(t("common.operationFailed") + ": " + e, "error");
    }
  };

  const handleDelete = async (ext: ExtensionRow) => {
    try {
      await deleteExt(ext.id);
      await loadExtensions();
      toast().show(t("plugins.removed"), "info");
    } catch (e) {
      toast().show(t("common.deleteFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
        <h2 className="text-sm font-semibold text-content dark:text-heading">{t("plugins.title")}</h2>
        <span className="text-[11px] text-faint">{t("plugins.desc")}</span>
        <div className="flex items-center gap-2 ml-auto">
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-4">
        {extensions.length === 0 ? (
          <EmptyState icon={<PackageIcon size={40} />} text={t("plugins.empty")} hint={t("plugins.emptyHint")} />
        ) : (
          <div className="space-y-1.5">
            {extensions.map((ext) => (
              <ExtRow key={ext.id} ext={ext} kindPath={paths[ext.id]} onToggle={() => handleToggle(ext)} onDelete={() => handleDelete(ext)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
