import { useState, useEffect, useMemo } from "react";
import { useExtensionsStore } from "../stores/extensions";
import { togglePlugin, deleteExt, extConfigPath } from "../lib/tauri";
import { Package as PackageIcon, Search } from "lucide-react";
import type { ExtensionRow } from "../types";
import { ExtRow, ExtCard } from "../components/ExtList";
import { useViewMode } from "../lib/useViewMode";
import ViewToggle from "../components/ViewToggle";
import { EmptyState } from "./MCPView";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import PageHeader, { ContentTitle } from "../components/PageHeader";
import SearchInput from "../components/SearchInput";

const toast = () => useToastStore.getState();

export default function PluginsView() {
  const t = useT();
  const { loadExtensions } = useExtensionsStore();
  const allExtensions = useExtensionsStore((s) => s.extensions);
  const extensions = useMemo(
    () => allExtensions.filter((e) => e.kind === "plugin"),
    [allExtensions],
  );
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useViewMode("plugins");
  const visible = useMemo(
    () => extensions.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())),
    [extensions, query],
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
    useExtensionsStore.setState((s) => ({
      extensions: s.extensions.map((e) => (e.id === ext.id ? { ...e, enabled: next } : e)),
    }));
    try {
      let cfg: { marketplace?: string } = {};
      try { cfg = JSON.parse(ext.config_json || "{}"); } catch { /* ignore */ }
      await togglePlugin({ name: ext.name, marketplace: cfg.marketplace || "", enabled: next });
      toast().show(next ? t("ext.enabled") : t("ext.disabled"), "info");
    } catch (e) {
      useExtensionsStore.setState((s) => ({
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
      <PageHeader
        toolbar={
          <>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <SearchInput value={query} onChange={setQuery} placeholder={t("plugins.search")} />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <ContentTitle title={t("plugins.title")} meta={t("plugins.desc")} />
        {extensions.length === 0 ? (
          <EmptyState icon={<PackageIcon size={40} />} text={t("plugins.empty")} hint={t("plugins.emptyHint")} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Search size={40} />} text={t("plugins.noMatch")} hint={t("plugins.noMatchHint")} />
        ) : viewMode === "grid" ? (
          <div className="px-6 pb-6 card-grid">
            {visible.map((ext) => (
              <ExtCard key={ext.id} ext={ext} kindPath={paths[ext.id]} onToggle={() => handleToggle(ext)} onDelete={() => handleDelete(ext)} />
            ))}
          </div>
        ) : (
          <div className="list-panel mx-6 mb-6">
            {visible.map((ext) => (
              <ExtRow key={ext.id} ext={ext} kindPath={paths[ext.id]} onToggle={() => handleToggle(ext)} onDelete={() => handleDelete(ext)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
