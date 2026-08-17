import { useState } from "react";
import { useAppStore } from "../stores/app";
import { saveRule, deleteRule, applyRule } from "../lib/tauri";
import { Plus, Trash2, X, Search, ScrollText, Copy, Check, FileOutput, Edit3 } from "lucide-react";
import type { Rule } from "../types";
import { PathButton } from "../components/ExtList";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";

const toast = () => useToastStore.getState();

export default function RulesView() {
  const t = useT();
  const { rules, loadRules } = useAppStore();
  const [query, setQuery] = useState("");
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
     await useAppStore.getState().loadActivity();
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
     <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
       <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rules.search")}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong"
          />
        </div>
       <div className="flex items-center gap-2 ml-auto">
         <button
           onClick={() => setEditing({ id: 0, title: "", content: "", platform: "claude", target_path: null, tags: [], source: "manual" })}
           className="btn btn-primary"
         >
           <Plus size={14} /> {t("rules.newTitle")}
         </button>
       </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-faint">
           <ScrollText size={40} />
           <p className="text-sm mt-2">{t("rules.empty")}</p>
         </div>
        ) : (
          <div className="p-4 grid grid-cols-2 gap-3">
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
                     className="text-faint hover:text-content dark:hover:text-content p-1"
                   >
                     <FileOutput size={14} />
                   </button>
                   <button
                     onClick={() => setEditing(r)}
                     title={t("common.edit")}
                     className="text-faint hover:text-content dark:hover:text-content p-1"
                   >
                     <Edit3 size={14} />
                   </button>
                   <button
                     onClick={() => deleteConfirmation.request(r.title, () => handleDelete(r.id))}
                     className="text-red-500 hover:text-red-600 p-1"
                   >
                     <Trash2 size={14} />
                   </button>
                 </div>
                </div>
                <p className="text-xs text-faint mt-1.5 line-clamp-3 font-mono">{r.content}</p>
              </div>
            ))}
          </div>
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
