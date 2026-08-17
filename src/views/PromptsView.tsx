import { useState } from "react";
import { useAppStore } from "../stores/app";
import { savePrompt, deletePrompt, saveRule } from "../lib/tauri";
import { Plus, Trash2, X, Search, FileText, Copy, Check, ScrollText } from "lucide-react";
import type { Prompt } from "../types";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";

const toast = () => useToastStore.getState();

export default function PromptsView() {
  const t = useT();
  const { prompts, loadPrompts } = useAppStore();
  const { loadRules } = useAppStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Prompt | null>(null);
  const deleteConfirmation = useDeleteConfirmation();

  const handleDelete = async (id: number) => {
    await deletePrompt(id);
    await loadPrompts();
    toast().show(t("prompts.deleted"), "info");
  };

  const handleApplyToRule = async (prompt: Prompt) => {
    const platform = prompt.tags.includes("codex")
      ? "codex"
      : prompt.tags.includes("claude")
        ? "claude"
        : "claude";
    await saveRule(null, prompt.title, prompt.content, platform, null, prompt.tags);
    await loadRules();
    toast().show(t("prompts.appliedToRule", { platform }));
 };

  const filtered = prompts.filter(
    (p) =>
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.content.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
     <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface">
       <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("prompts.search")}
          className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-border-strong"
        />
      </div>
       <div className="flex items-center gap-2 ml-auto">
         <button
           onClick={() => setEditing({ id: 0, title: "", content: "", tags: [], source: "manual" })}
            className="btn btn-primary"
          >
            <Plus size={14} /> {t("prompts.newTitle")}
          </button>
       </div>
     </div>

     <div className="flex-1 overflow-y-auto bg-page">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-faint">
            <FileText size={40} />
            <p className="text-sm mt-2">{t("prompts.empty")}</p>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 gap-3">
           {filtered.map((p) => (
              <div key={p.id} onClick={() => setEditing(p)} className="card p-4 cursor-pointer hover:border-border-strong hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-heading truncate">{p.title}</h3>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyToRule(p).catch((err) => {
                          toast().show(t("prompts.applyToRuleFailed", { msg: String(err) }), "error");
                        });
                      }}
                      title={t("prompts.applyToRule")}
                      className="btn-icon"
                    >
                      <ScrollText size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConfirmation.request(p.title, () => handleDelete(p.id));
                      }}
                      className="btn-icon btn-icon-danger"
                      title={t("common.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-faint mt-1.5 line-clamp-3">{p.content}</p>
                {p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.tags.map((tag) => (
                      <span key={tag} className="badge bg-surface-2 text-muted">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <PromptEditor
          prompt={editing}
          t={t}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await loadPrompts();
            setEditing(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-prompt-dialog" />
    </div>
  );
}

function PromptEditor({
  prompt,
  t,
  onClose,
  onSaved,
}: {
  prompt: Prompt;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(prompt.title);
  const [content, setContent] = useState(prompt.content);
  const [tags, setTags] = useState<string[]>(prompt.tags);
  const [copied, setCopied] = useState(false);
  const isNew = prompt.id === 0;

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    try {
      await savePrompt(isNew ? null : prompt.id, title.trim(), content, tags);
      toast().show(isNew ? t("prompts.created") : t("prompts.saved"));
      onSaved();
    } catch (e) {
      toast().show(t("common.saveFailed", { msg: String(e) }), "error");
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
          <h3 className="text-sm font-bold">{isNew ? t("prompts.newTitle") : t("prompts.editTitle")}</h3>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("common.title")}
            className="input"
            autoFocus
          />
          <TagInput tags={tags} onChange={setTags} placeholder={t("common.tagInputPlaceholder")} />
        </div>

        <div className="flex-1 px-5 pb-5 min-h-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("prompts.contentPlaceholder")}
            className="w-full h-[350px] p-3 text-sm font-mono text-content border border-border rounded-lg resize-none focus:outline-none focus:border-border-strong"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button
            onClick={handleCopy}
            className="btn btn-ghost mr-auto"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("common.copied") : t("common.copyAll")}
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

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  const commitDraft = (raw: string) => {
    const next = raw
      .split(/[,，]/)
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (!next.length) return;
    const merged = [...tags];
    for (const tag of next) {
      if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase())) merged.push(tag);
    }
    onChange(merged);
    setDraft("");
  };

  return (
    <div className="input flex flex-wrap items-center gap-1.5 !py-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-xs text-muted"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((item) => item !== tag))}
            aria-label={t("common.delete")}
            className="text-red-500 hover:text-red-600"
            title={t("common.delete")}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          if (/[,，]/.test(e.target.value)) commitDraft(e.target.value);
          else setDraft(e.target.value);
        }}
        onBlur={() => commitDraft(draft)}
        aria-label={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        placeholder={tags.length ? "" : placeholder}
        className="flex-1 min-w-[100px] bg-transparent text-sm outline-none placeholder:text-faint"
      />
      {draft.trim() && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => commitDraft(draft)}
          className="btn-icon btn-icon-sm"
          title={t("common.addTag")}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}
