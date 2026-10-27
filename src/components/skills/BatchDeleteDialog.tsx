import { Trash2, TriangleAlert } from "lucide-react";
import { useSkillsStore } from "../../stores/skills";
import { useT } from "../../i18n";

export default function BatchDeleteDialog() {
  const t = useT();
  const {
    batchDeleteIds, batchDeleting, skills,
    cancelBatchDelete, confirmBatchDelete,
  } = useSkillsStore();
  if (!batchDeleteIds || batchDeleteIds.length === 0) return null;

  const names = batchDeleteIds
    .map((id) => skills.find((s) => s.id === id)?.name ?? id)
    .slice(0, 5);
  const extra = batchDeleteIds.length - names.length;

  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !batchDeleting) cancelBatchDelete();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-delete-title"
        data-testid="skill-batch-delete-dialog"
        className="connection-dialog"
      >
        <div className="connection-dialog-icon">
          <TriangleAlert size={18} />
        </div>
        <div className="min-w-0">
          <h3 id="batch-delete-title" className="connection-dialog-title">
            {t("skills.batchDelete.title")}
          </h3>
          <p className="connection-dialog-message">
            {t("skills.batchDelete.desc", { count: batchDeleteIds.length })}
            <span className="connection-dialog-path">
              {names.join("、")}{extra > 0 ? t("skills.batchDelete.more", { count: extra }) : ""}
            </span>
          </p>
          <div className="connection-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={cancelBatchDelete}
              disabled={batchDeleting}
              autoFocus
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={confirmBatchDelete}
              disabled={batchDeleting}
            >
              <Trash2 size={13} /> {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
