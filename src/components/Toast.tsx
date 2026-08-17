import { useToastStore, type ToastType } from "../stores/toast";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

const config: Record<ToastType, { icon: typeof CheckCircle2; classes: string }> = {
  success: { icon: CheckCircle2, classes: "text-emerald-500" },
  error: { icon: XCircle, classes: "text-red-500" },
  info: { icon: Info, classes: "text-blue-500" },
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end">
      {toasts.map((t) => {
        const { icon: Icon, classes } = config[t.type];
        return (
          <div
            key={t.id}
            className="flex items-center gap-2 bg-surface border border-border-strong rounded-lg shadow-lg px-4 py-2.5 min-w-[200px] max-w-[360px] animate-in"
            style={{ animation: "toast-in 0.2s ease-out" }}
          >
            <Icon size={16} className={classes + " shrink-0"} />
            <span className="text-sm text-content dark:text-content flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-muted shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
