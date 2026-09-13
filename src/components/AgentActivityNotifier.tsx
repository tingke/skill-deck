import { useEffect } from "react";
import { getAgentActivitySnapshot } from "../lib/tauri";
import {
  diffAgentActivityNotifications,
  type AgentActivityNotification,
} from "../lib/agentActivityNotifications";
import { useActivityStore } from "../stores/activity";
import { useToastStore, type ToastType } from "../stores/toast";
import { useT } from "../i18n";
import type { TranslationKey } from "../i18n";

const STATE_LABEL_KEYS: Record<string, TranslationKey> = {
  working: "agentNotifications.working",
  waiting: "agentNotifications.waiting",
  failed: "agentNotifications.failed",
  done: "agentNotifications.done",
};

function notificationMessage(
  notification: AgentActivityNotification,
  t: ReturnType<typeof useT>,
): string {
  if (notification.type === "task-progress") {
    if (notification.previousProgress === undefined) {
      if (notification.progress === undefined) {
        return t("agentNotifications.taskStartedNoProgress", {
          agent: notification.agent,
          title: notification.taskTitle ?? "",
        });
      }
      return t("agentNotifications.taskStarted", {
        agent: notification.agent,
        title: notification.taskTitle ?? "",
        progress: notification.progress,
      });
    }
    if (notification.progress === undefined) {
      return t("agentNotifications.taskUpdated", {
        title: notification.taskTitle ?? "",
        status: notification.taskStatus ?? "",
        step: notification.taskStep ?? "",
      });
    }
    return t("agentNotifications.taskProgress", {
      title: notification.taskTitle ?? "",
      from: notification.previousProgress,
      to: notification.progress,
    });
  }

  return t("agentNotifications.agentState", {
    agent: notification.agent,
    state: t(STATE_LABEL_KEYS[notification.state ?? "working"] ?? "agentNotifications.working"),
  });
}

function notificationType(notification: AgentActivityNotification): ToastType {
  if (notification.type === "agent-state") {
    if (notification.state === "failed") return "error";
    if (notification.state === "done") return "success";
  }
  return "info";
}

export default function AgentActivityNotifier() {
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    let hasBaseline = false;
    let previous = useActivityStore.getState().agentActivity;

    const load = async () => {
      try {
        const snapshot = await getAgentActivitySnapshot();
        if (cancelled) return;
        const notifications = diffAgentActivityNotifications(previous, snapshot, { hasBaseline });
        useActivityStore.setState({ agentActivity: snapshot });
        previous = snapshot;
        hasBaseline = true;
        for (const notification of notifications) {
          useToastStore
            .getState()
            .show(notificationMessage(notification, t), notificationType(notification));
        }
      } catch {
        // Hook observation is optional; keep the app usable when it is absent.
      }
    };

    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  // Keep the baseline stable across unrelated app re-renders; language changes do
  // not need to restart observation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
