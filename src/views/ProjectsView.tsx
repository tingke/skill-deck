import { useState } from "react";
import { useAppStore } from "../stores/app";
import { saveProject, deleteProject, pickProjectFolder, createPkgFromProject } from "../lib/tauri";
import { revealInFinder } from "../lib/tauri";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";
import { FolderKanban, Plus, Trash2, Edit3, X, FolderOpen, BookOpen, PackagePlus } from "lucide-react";
import type { ProjectRow } from "../types";
import type { TranslationKey } from "../i18n";
import { useDeleteConfirmation } from "../lib/deleteConfirmation";
import DeleteConfirmDialog from "../components/DeleteConfirmDialog";

const toast = () => useToastStore.getState();

const COLOR_MAP: Record<string, { dot: string; text: string }> = {
  orange: { dot: "bg-orange-500", text: "text-orange-600" },
  green: { dot: "bg-green-500", text: "text-green-600" },
  blue: { dot: "bg-sky-500", text: "text-sky-600" },
  violet: { dot: "bg-violet-500", text: "text-violet-600" },
  slate: { dot: "bg-muted", text: "text-muted" },
  red: { dot: "bg-red-500", text: "text-red-600" },
  amber: { dot: "bg-amber-500", text: "text-amber-600" },
  cyan: { dot: "bg-cyan-500", text: "text-cyan-600" },
};

const COLOR_LABEL_KEYS: Record<string, TranslationKey> = {
  orange: "projects.colorOrange",
  green: "projects.colorGreen",
  blue: "projects.colorBlue",
  violet: "projects.colorViolet",
  slate: "projects.colorSlate",
  red: "projects.colorRed",
  amber: "projects.colorAmber",
  cyan: "projects.colorCyan",
};

function colorOf(c: string) {
  return COLOR_MAP[c] || COLOR_MAP.slate;
}

export default function ProjectsView() {
  const t = useT();
  const { projects, skills, loadProjects, scanNow, loadPackages, loadActivity } = useAppStore();
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [presetProjectId, setPresetProjectId] = useState<string | null>(null);
  const deleteConfirmation = useDeleteConfirmation();

  const handleAdd = async () => {
    const folder = await pickProjectFolder();
    if (!folder) return;
    const name = folder.split("/").pop() || t("projects.untitled");
    const project: ProjectRow = {
      id: "",
      name,
      path: folder,
      color: "slate",
      sort_order: projects.length,
      skill_count: 0,
      created_at: "",
      updated_at: "",
    };
    try {
      await saveProject(project);
      await loadProjects();
      await scanNow();
      toast().show(t("projects.added", { name }));
    } catch (e) {
      toast().show(t("common.addFailed", { msg: String(e) }), "error");
    }
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    await loadProjects();
    await scanNow();
    toast().show(t("projects.deleted"), "info");
  };

  const handleAddToPreset = async (project: ProjectRow) => {
    if (presetProjectId) return;
    setPresetProjectId(project.id);
    try {
      const preset = await createPkgFromProject(project.id);
      await loadPackages();
      await loadActivity();
      toast().show(t("projects.presetUpdated", { name: preset.display_name || preset.name }));
    } catch (e) {
      toast().show(t("projects.presetFailed", { msg: String(e) }), "error");
    } finally {
      setPresetProjectId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
        <div className="text-xs text-faint">
          {t("projects.desc")}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <button
            onClick={handleAdd}
            className="btn btn-primary"
          >
            <Plus size={14} /> {t("projects.add")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-page p-6">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-faint">
            <FolderKanban size={48} />
            <p className="text-sm mt-3">{t("projects.empty")}</p>
            <p className="text-xs mt-1">{t("projects.emptyHint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {projects.map((p) => {
              const c = colorOf(p.color);
              const projectSkills = skills.filter((s) => s.id.startsWith(`project:${p.id}:`));
              return (
                <div
                  key={p.id}
                  className="card p-4 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-heading truncate">{p.name}</h3>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleAddToPreset(p)}
                        disabled={presetProjectId === p.id}
                        title={t("projects.addToPreset")}
                        className="btn-icon"
                      >
                        <PackagePlus size={14} />
                      </button>
                      <button onClick={() => setEditing(p)} title={t("common.edit")} className="btn-icon">
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => deleteConfirmation.request(p.name, () => handleDelete(p.id))}
                        title={t("common.delete")}
                        className="btn-icon btn-icon-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                 <div className="mt-2">
                   <div className="flex items-center gap-1.5 text-[11px] text-muted">
                     <FolderOpen size={11} className="shrink-0" />
                     <code
                       className="font-mono truncate flex-1 cursor-pointer hover:text-content dark:hover:text-content transition-colors"
                       onClick={() => revealInFinder(p.path)}
                       title={t("projects.openInFinder")}
                     >
                       {p.path}
                     </code>
                   </div>
                 </div>

                  <div className="flex items-center gap-3 mt-3 text-[11px]">
                    <span className="text-faint flex items-center gap-0.5">
                      <BookOpen size={11} /> <span className={`font-semibold ${c.text}`}>{t("projects.skillCount", { count: projectSkills.length })}</span>
                    </span>
                  </div>

                  {projectSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {projectSkills.slice(0, 6).map((s) => (
                        <span key={s.id} className="text-[10px] text-muted bg-surface-2  px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                      ))}
                      {projectSkills.length > 6 && (
                        <span className="text-[10px] text-faint">+{projectSkills.length - 6}</span>
                      )}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <ProjectEditor
          project={editing}
          t={t}
          onClose={() => setEditing(null)}
          onDone={async () => {
            await loadProjects();
            await scanNow();
            setEditing(null);
          }}
        />
      )}

      <DeleteConfirmDialog controller={deleteConfirmation} testId="delete-project-dialog" />
    </div>
  );
}

function ProjectEditor({
  project,
  t,
  onClose,
  onDone,
}: {
  project: ProjectRow;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      await saveProject({
        ...project,
        name: name.trim(),
        color,
      });
      toast().show(t("projects.saved"));
      onDone();
    } catch (e) {
      toast().show(t("common.saveFailed", { msg: String(e) }), "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-[440px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold dark:text-heading">{t("projects.editTitle")}</h3>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("projects.nameLabel")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("projects.pathLabel")}</label>
            <code className="text-xs text-muted font-mono block px-3 py-1.5 bg-surface-2  rounded-lg break-all">
              {project.path}
            </code>
          </div>
          <div>
            <label className="text-[11px] text-faint mb-1 block">{t("common.color")}</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.entries(COLOR_MAP).map(([n, c]) => (
                <button
                  key={n}
                  onClick={() => setColor(n)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    color === n ? "scale-110 ring-2 ring-offset-1 dark:ring-offset-surface ring-border-strong" : "border-transparent"
                  } ${c.dot}`}
                  title={t(COLOR_LABEL_KEYS[n])}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
