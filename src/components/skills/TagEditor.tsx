import { useState } from "react";
import { X, Check, Plus } from "lucide-react";
import { useSkillsStore } from "../../stores/skills";
import { useT } from "../../i18n";

export function TagEditor({ skillId, tags }: { skillId: string; tags: string[] }) {
  const t = useT();
  const { updateTags } = useSkillsStore();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const addTag = () => {
    const value = text.trim();
    if (value && !tags.includes(value)) {
      updateTags(skillId, [...tags, value]);
    }
    setText("");
    setAdding(false);
  };

  const removeTag = (tag: string) => {
    updateTags(skillId, tags.filter((item) => item !== tag));
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTag();
            if (e.key === "Escape") { setText(""); setAdding(false); }
          }}
          placeholder={t("skills.detail.tagPlaceholder")}
          className="input flex-1 min-w-[140px]"
          autoFocus
        />
        <button onClick={addTag} className="p-1 text-emerald-500 hover:text-emerald-700"><Check size={14} /></button>
        <button
          onClick={() => { setText(""); setAdding(false); }}
          className="btn-icon btn-icon-sm"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.length > 0 ? (
        tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-2xs pl-2 pr-1 py-0.5 rounded-md bg-accent-soft text-accent font-medium"
          >
            <span className="max-w-[160px] truncate">{tag}</span>
            <button
              onClick={() => removeTag(tag)}
              className="text-red-500 hover:text-red-600 transition-colors"
              title={t("skills.detail.removeTag")}
            >
              <X size={10} />
            </button>
          </span>
        ))
      ) : (
        <span className="text-2xs text-faint">{t("common.noTags")}</span>
      )}
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-0.5 text-2xs text-faint hover:text-accent px-1.5 py-0.5 rounded-md hover:bg-accent-soft"
      >
        <Plus size={10} /> {t("skills.detail.addTag")}
      </button>
    </div>
  );
}
