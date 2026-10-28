import { useEffect, useState } from "react";
import { useAssetsStore } from "../stores/assets";
import { useUiStore } from "../stores/ui";
import { useActivityStore } from "../stores/activity";
import { saveRule, deleteRule, applyRule } from "../lib/tauri";
import { Plus, Trash2, X, Search, ScrollText, Copy, Check, FileOutput, Edit3, ChevronRight } from "lucide-react";
import SearchInput from "../components/SearchInput";
import { useViewMode } from "../lib/useViewMode";
import ViewToggle from "../components/ViewToggle";
import PageHeader, { ContentTitle } from "../components/PageHeader";
import DetailDrawer from "../components/DetailDrawer";
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
  const [viewMode, setViewMode] = useViewMode("rules");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [copiedDetail, setCopiedDetail] = useState(false);
  const deleteConfirmation = useDeleteConfirmation();

  // 从提示词页跳转过来：以此草稿打开新建规则编辑器（仅挂载时处理一次）
  useEffect(() => {
    const draft = useUiStore.getState().pendingRuleDraft;
    if (draft) {
      setEditing({ id: 0, title: draft.title, content: draft.content, platform: "claude", target_path: null, tags: draft.tags, source: "manual" });
      useUiStore.getState().setPendingRuleDraft(null);
    }
  }, []);

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
  const detailRule = detailId !== null ? rules.find((r) => r.id === detailId) ?? null : null;

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
                  onClick={() => setDetailId(r.id)}
                  className={"list-row list-row--generic" + (detailId === r.id ? " list-row--selected" : "")}
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
              <div
                key={r.id}
                onClick={() => setDetailId(r.id)}
                className="card card-hover p-4 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-heading truncate">{r.title}</h3>
                    <span className={`badge mt-1 ${
                      r.platform === "codex" ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600"
                    }`}>
                      {r.platform === "codex" ? t("rules.platformCodex") : t("rules.platformClaude")}
                    </span>
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

      {/* ===== 规则详情抽屉 ===== */}
      <DetailDrawer
        open={detailRule !== null}
        onClose={() => setDetailId(null)}
        testId="rule-detail-drawer"
        fillBody
        icon={<ScrollText size={18} className="text-faint shrink-0" />}
        title={detailRule?.title ?? ""}
        subtitle={
          detailRule && (
            <span className="flex items-center gap-1.5">
              <span className={"badge " + (detailRule.platform === "codex" ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600")}>
                {detailRule.platform === "codex" ? t("rules.platformCodex") : t("rules.platformClaude")}
              </span>
            </span>
          )
        }
        actions={
          detailRule && (
            <>
              <button
                onClick={() => setEditing(detailRule)}
                className="btn-icon rounded-full bg-surface-2"
                title={t("common.edit")}
                aria-label={t("common.edit")}
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={() => deleteConfirmation.request(detailRule.title, () => handleDelete(detailRule.id))}
                className="btn-icon rounded-full bg-surface-2 text-red-500 hover:text-red-600"
                title={t("common.delete")}
                aria-label={t("common.delete")}
              >
                <Trash2 size={14} />
              </button>
            </>
          )
        }
      >
        {detailRule && (
          <div className="flex-1 min-h-0 flex flex-col px-5 py-3.5">
            <div className="flex items-center mb-2 shrink-0 min-w-0">
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider">
                {t("rules.detailContent")}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {detailRule.target_path && <PathButton path={detailRule.target_path} />}
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(detailRule.content);
                    setCopiedDetail(true);
                    setTimeout(() => setCopiedDetail(false), 1500);
                  }}
                  className="btn-icon btn-icon-sm"
                  title={copiedDetail ? t("common.copied") : t("common.copy")}
                  aria-label={t("common.copy")}
                >
                  {copiedDetail ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  onClick={() => handleApply(detailRule.id)}
                  className="btn-icon btn-icon-sm"
                  title={t("rules.writeTooltip")}
                  aria-label={t("rules.writeTooltip")}
                >
                  <FileOutput size={14} />
                </button>
              </div>
            </div>
            <pre className="flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap break-words text-xs font-mono text-content leading-relaxed rounded-lg bg-surface-2 p-3">
              {detailRule.content}
            </pre>
          </div>
        )}
      </DetailDrawer>

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-surface rounded-2xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold">{isNew ? t("rules.newTitle") : t("rules.editTitle")}</h3>
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
