import { Link2, TriangleAlert } from "lucide-react";
import type { SharedDisconnectConfirmation } from "../types";

interface Props {
  confirmation: SharedDisconnectConfirmation | null;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConnectionConfirmationDialog({
  confirmation,
  confirming,
  onCancel,
  onConfirm,
}: Props) {
  if (!confirmation) return null;

  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-disconnect-title"
        data-testid="shared-disconnect-dialog"
        className="connection-dialog"
      >
        <div className="connection-dialog-icon">
          <TriangleAlert size={18} />
        </div>
        <div className="min-w-0">
          <h3 id="shared-disconnect-title" className="connection-dialog-title">
            断开共享连接
          </h3>
          <p className="connection-dialog-message">
            <span className="connection-dialog-skill">{confirmation.skillName}</span>
            {" 的连接会同时影响："}
            <span className="connection-dialog-agents">
              {confirmation.affectedAgents.join("、")}
            </span>
            。断开后这些 Agent 都不能再发现该 Skill。
          </p>
          <div className="connection-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
              disabled={confirming}
              autoFocus
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onConfirm}
              disabled={confirming}
            >
              <Link2 size={13} /> 全部断开
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
