import { Trash2, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";
import type { DeleteConfirmationController } from "../lib/deleteConfirmation";

export function DeleteConfirmDialogBody({
  name,
  deleting,
  onCancel,
  onConfirm,
  testId = "delete-confirm-dialog",
}: {
  name: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
}) {
  const t = useT();

  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        data-testid={testId}
        className="connection-dialog"
      >
        <div className="connection-dialog-icon">
          <TriangleAlert size={18} />
        </div>
        <div className="min-w-0">
          <h3 id="delete-confirm-title" className="connection-dialog-title">
            {t("common.deleteConfirmTitle")}
          </h3>
          <p className="connection-dialog-message">
            {t("common.deleteConfirmMessage", { name })}
          </p>
          <div className="connection-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
              disabled={deleting}
              autoFocus
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onConfirm}
              disabled={deleting}
            >
              <Trash2 size={13} /> {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeleteConfirmDialog({
  controller,
  testId,
}: {
  controller: DeleteConfirmationController;
  testId?: string;
}) {
  if (!controller.confirmation) return null;

  return (
    <DeleteConfirmDialogBody
      name={controller.confirmation.name}
      deleting={controller.deleting}
      onCancel={controller.cancel}
      onConfirm={controller.confirm}
      testId={testId}
    />
  );
}
