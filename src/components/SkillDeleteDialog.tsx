import { Trash2, TriangleAlert } from "lucide-react";
import type { SkillDeleteConfirmation } from "../types";

interface Props {
  confirmation: SkillDeleteConfirmation | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function SkillDeleteDialog({
  confirmation,
  deleting,
  onCancel,
  onConfirm,
}: Props) {
  if (!confirmation) return null;

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
        aria-labelledby="skill-delete-title"
        data-testid="skill-delete-dialog"
        className="connection-dialog"
      >
        <div className="connection-dialog-icon">
          <TriangleAlert size={18} />
        </div>
        <div className="min-w-0">
          <h3 id="skill-delete-title" className="connection-dialog-title">
            删除 Skill
          </h3>
          <p className="connection-dialog-message">
            确认删除 <span className="connection-dialog-skill">{confirmation.name}</span> 吗？此操作会删除：
            <span className="connection-dialog-path">{confirmation.path}</span>
          </p>
          <div className="connection-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
              disabled={deleting}
              autoFocus
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onConfirm}
              disabled={deleting}
            >
              <Trash2 size={13} /> 删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
