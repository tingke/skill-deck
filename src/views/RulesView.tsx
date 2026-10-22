import { useState } from "react";
import { useAssetsStore } from "../stores/assets";
import { useActivityStore } from "../stores/activity";
import { saveRule, deleteRule, applyRule } from "../lib/tauri";
import { Plus, Trash2, X, Search, ScrollText, Copy, Check, FileOutput, Edit3, ChevronRight } from "lucide-react";
import RowMenu from "../components/RowMenu";
import SearchInput from "../components/SearchInput";
import ViewToggle from "../components/ViewToggle";
import PageHeader, { ContentTitle } from "../components/PageHeader";
import type { Rule } from "../types";
import { PathButton } from "../components/ExtList";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";

const toast = () => useToastStore.getState();

export default function RulesView() {
  const t = useT();
  const { rules, loadRules } = useAssetsStore();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editing, setEditing] = useState<Rule | null>(null);
  const deleteConfirmation = useDeleteConfirmation();

 const handleDelete = async (id: number) => {
   await deleteRule(id);
   await loadRules();
   toast().show(t("rules.deleted"), "info");
 };
 const handleApply = async (id: number) => {
   try {
     await applyRule(id);
     toast().show(t("rules.written"));
     await useActivityStore.getState().loadActivity();
   } catch (e) {
     toast().show(t("rules.writeFailed", { msg: String(e) }), "error");
   }
 };
  const filtered = rules.filter(
    (r) =>
      r.title.toLowerCase().includes(query.toLowerCase()) ||
      r.content.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        toolbar={
          <>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <SearchInput value={query} onChange={setQuery} placeholder={t("rules.search")} />
          </>
        }
        actions={
          <button
            onClick={() => setEditing({ id: 0, title: "", content: "", platform: "claude", target_path: null, tags: [], source: "manual" })}
            className="btn btn-primary"
          >
            <Plus size={14} /> {t("rules.newTitle")}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          rules.length === 0 ? (
            <div className="empty-state h-full">
              <div className="empty-state__icon">
                <ScrollText size={22} strokeWidth={1.5} />
              </div>
              <p className="empty-state__title">{t("rules.empty")}</p>
              <p className="empty-state__hint">{t("rules.emptyDesc")}</p>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setEditing({ id: 0, title: "", content: "", platform: "claude", target_path: null, tags: [], source: "manual" })}
                  className="btn btn-primary"
                >
                  <Plus size={14} /> {t("rules.newTitle")}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state h-full">
              <div className="empty-state__icon">
                <Search size={22} strokeWidth={1.5} />
              </div>
              <p className="empty-state__title">{t("rules.noMatch")}</p>
              <p className="empty-state__hint">{t("rules.noMatchHint")}</p>
            </div>
          )
        ) : (
          <>
          <ContentTitle title={t("rules.title")} meta={t("rules.subtitle")} />
          {viewMode === "list" ? (
            <div className="list-panel mx-6 mb-6">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setEditing(r)}
                  className="list-row list-row--generic"
                >
                  <span className="list-row__name">{r.title}</span>
                  <span className="list-row__desc font-mono">{r.content}</span>
                  <span className={"badge shrink-0 " + (r.platform === "codex" ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600")}>
                    {r.platform === "codex" ? t("rules.platformCodex") : t("rules.platformClaude")}
                  </span>
                  <ChevronRight size={14} className="list-row__chev" />
                </button>
              ))}
            </div>
          ) : (
          <div className="px-6 pb-6 card-grid">
            {filtered.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-heading truncate">{r.title}</h3>
                    <span className={`badge mt-1 ${
                      r.platform === "codex" ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600"
                    }`}>
                      {r.platform === "codex" ? t("rules.platformCodex") : t("rules.platformClaude")}
                    </span>
                    {r.target_path && <div className="inline-block align-middle ml-1"><PathButton path={r.target_path} /></div>}
                  </div>
                 <div className="flex items-center gap-1 shrink-0 ml-2">
                   <button
                     onClick={() => handleApply(r.id)}
                     title={t("rules.writeTooltip")}
                     className="btn-icon"
                   >
                     <FileOutput size={14} />
                   </button>
                   <RowMenu
                     ariaLabel={t("common.more")}
                     items={[
                       { label: t("common.edit"), icon: <Edit3 size={13} />, onSelect: () => setEditing(r) },
                       {
                         label: t("common.delete"),
                         icon: <Trash2 size={13} />,
                         danger: true,
                         onSelect: () => deleteConfirmation.request(r.title, () => handleDelete(r.id)),
                       },
                     ]}
                   />
                 </div>
                </div>
                <p className="text-xs text-faint mt-1.5 line-clamp-3 font-mono">{r.content}</p>
              </div>
            ))}
          </div>
          )}
          </>
        )}
      </div>

      {editing && (
        <RuleEditor
          rule={editing}
          t={t}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await loadRules();
            setEditing(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-rule-dialog" />
    </div>
  );
}

function RuleEditor({
  rule,
  t,
  onClose,
  onSaved,
}: {
  rule: Rule;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(rule.title);
  const [content, setContent] = useState(rule.content);
  const [platform, setPlatform] = useState(rule.platform);
  const [targetPath, setTargetPath] = useState(rule.target_path || "");
  const [copied, setCopied] = useState(false);
  const isNew = rule.id === 0;

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    try {
      await saveRule(
        isNew ? null : rule.id,
        title.trim(),
        content,
        platform,
        targetPath.trim() || null,
        rule.tags,
      );
      toast().show(isNew ? t("rules.created") : t("rules.saved"));
      onSaved();
    } catch (e) {
      toast().show(t("common.saveFailed", { msg: String(e) }), "error");
    }
 };
 const handleApplyToDisk = async () => {
   if (!title.trim() || !content.trim()) return;
   try {
     const saved = await saveRule(
       isNew ? null : rule.id,
       title.trim(),
       content,
       platform,
       targetPath.trim() || null,
       rule.tags,
     );
     await applyRule(saved.id);
     toast().show(t("rules.savedAndWritten"));
     onSaved();
   } catch (e) {
     toast().show(t("rules.writeFailed", { msg: String(e) }), "error");
   }
 };

 const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-surface rounded-2xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold">{isNew ? t("rules.newTitle") : t("rules.editTitle")}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="btn btn-ghost btn-sm"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("common.copied") : t("common.copy")}
            </button>
            <button onClick={onClose} className="btn-icon">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("common.title")}
            className="input"
            autoFocus
          />
          <div className="flex gap-3">
            <div className="flex items-center bg-surface-2 rounded-lg p-0.5">
              {(["claude", "codex"] as const).map((rt) => (
                <button
                  key={rt}
                  onClick={() => setPlatform(rt)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    platform === rt
                      ? rt === "codex"
                        ? "bg-green-600 text-white"
                        : "bg-orange-500 text-white"
                      : "text-muted"
                  }`}
                >
                  {rt === "codex" ? "Codex" : "Claude"}
                </button>
              ))}
            </div>
            <input
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder={t("rules.targetPathPlaceholder")}
              className="flex-1 px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:border-border-strong bg-transparent dark:text-content"
            />
          </div>
        </div>

        <div className="flex-1 px-5 pb-5 min-h-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("rules.contentPlaceholder")}
            className="w-full h-[300px] p-3 text-xs font-mono text-content border border-border rounded-lg resize-none focus:outline-none focus:border-border-strong"
            spellCheck={false}
          />
        </div>

       <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
         <button
           onClick={handleApplyToDisk}
           disabled={!title.trim() || !content.trim()}
           className="btn btn-outline mr-auto"
         >
           <FileOutput size={14} /> {t("rules.writeToFile")}
         </button>
         <button onClick={onClose} className="btn btn-ghost">
           {t("common.cancel")}
         </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !content.trim()}
            className="btn btn-primary"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
