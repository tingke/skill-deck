import { useState } from "react";
import { ChevronRight, ChevronDown, FolderOpen, FolderClosed, FileText } from "lucide-react";
import type { SkillFileEntry } from "../../types";

export function DetailFileTree({
  entries, depth, activePath, onSelect,
}: {
  entries: SkillFileEntry[]; depth: number; activePath?: string;
  onSelect: (entry: SkillFileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const paddingLeft = `${depth * 12 + 6}px`;

  return (
    <div>
      {entries.map((entry) =>
        entry.is_dir ? (
          <div key={entry.path}>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-1 py-1 pr-2 text-xs text-muted hover:text-content transition-colors"
              style={{ paddingLeft }}
            >
              {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
              {expanded ? <FolderOpen size={12} className="shrink-0 text-accent" /> : <FolderClosed size={12} className="shrink-0 text-faint" />}
              <span className="truncate">{entry.name}</span>
            </button>
            {expanded && (
              <DetailFileTree entries={entry.children} depth={depth + 1} activePath={activePath} onSelect={onSelect} />
            )}
          </div>
        ) : (
          <button
            key={entry.path}
            onClick={() => onSelect(entry)}
            title={entry.path}
            className={
              "w-full flex items-center gap-1 py-1 pr-2 text-xs rounded transition-colors " +
              (activePath === entry.path ? "text-accent font-semibold" : "text-muted hover:text-content")
            }
            style={{ paddingLeft }}
          >
            <FileText size={12} className={"shrink-0 " + (entry.name.toUpperCase().endsWith(".MD") ? "text-accent" : "text-faint")} />
            <span className="truncate">{entry.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
