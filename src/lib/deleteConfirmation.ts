import { useCallback, useState } from "react";
import { useToastStore } from "../stores/toast";
import { useT } from "../i18n";

export interface DeleteConfirmation {
  name: string;
  action: () => void | Promise<void>;
}

export function useDeleteConfirmation() {
  const t = useT();
  const toast = useToastStore.getState;
  const [confirmation, setConfirmation] = useState<DeleteConfirmation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const request = useCallback((name: string, action: () => void | Promise<void>) => {
    setConfirmation({ name, action });
  }, []);

  const cancel = useCallback(() => {
    if (deleting) return;
    setConfirmation(null);
  }, [deleting]);

  const confirm = useCallback(async () => {
    if (!confirmation || deleting) return;
    setDeleting(true);
    try {
      await confirmation.action();
      setConfirmation(null);
    } catch (e) {
      toast().show(t("common.deleteFailed", { msg: String(e) }), "error");
    } finally {
      setDeleting(false);
    }
  }, [confirmation, deleting, t, toast]);

  return { confirmation, deleting, request, cancel, confirm };
}

export type DeleteConfirmationController = ReturnType<typeof useDeleteConfirmation>;
