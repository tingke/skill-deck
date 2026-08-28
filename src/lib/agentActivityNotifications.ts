import type { AgentActivitySnapshot } from "../types";

export type AgentActivityNotificationType = "agent-state" | "task-progress";

export interface AgentActivityNotification {
  key: string;
  type: AgentActivityNotificationType;
  agent: string;
  state?: string;
  taskTitle?: string;
  taskStatus?: string;
  taskStep?: string | null;
  previousProgress?: number;
  progress?: number;
}

interface SessionState {
  agent: string;
  state: string;
}

interface TaskState {
  title: string;
  progressPercent?: number;
  status: string;
  step: string | null;
  activeAgent: string | null;
}

function latestSessionStates(snapshot: AgentActivitySnapshot): Map<string, SessionState> {
  const sessions = new Map<string, SessionState>();
  // The backend returns newest events first. Keep the first state for each session.
  for (const event of snapshot.events) {
    if (!sessions.has(event.sessionId)) {
      sessions.set(event.sessionId, {
        agent: event.agent,
        state: event.state,
      });
    }
  }
  return sessions;
}

function taskStates(snapshot: AgentActivitySnapshot): Map<string, TaskState> {
  const tasks = new Map<string, TaskState>();
  for (const task of snapshot.tasks) {
    tasks.set(`${task.projectPath}:${task.taskId}`, {
      title: task.title,
      progressPercent: task.progress === null ? undefined : Math.round(task.progress * 100),
      status: task.status,
      step: task.step,
      activeAgent: task.activeAgent,
    });
  }
  return tasks;
}

/**
 * Derive user-visible changes from two consecutive snapshots. The first pass is
 * a baseline, so historical journal entries do not flood the client on launch.
 */
export function diffAgentActivityNotifications(
  previous: AgentActivitySnapshot | null,
  current: AgentActivitySnapshot,
  options: { hasBaseline: boolean },
): AgentActivityNotification[] {
  if (!options.hasBaseline) {
    return [];
  }

  const notifications: AgentActivityNotification[] = [];
  const previousSessions = latestSessionStates(previous ?? { events: [], tasks: [] });
  const currentSessions = latestSessionStates(current);
  for (const [key, state] of currentSessions) {
    const oldState = previousSessions.get(key);
    if (!oldState || oldState.state === state.state) continue;
    notifications.push({
      key: `agent:${key}`,
      type: "agent-state",
      agent: state.agent,
      state: state.state,
    });
  }

  const previousTasks = taskStates(previous ?? { events: [], tasks: [] });
  const currentTasks = taskStates(current);
  for (const [key, task] of currentTasks) {
    const oldTask = previousTasks.get(key);
    if (!task.activeAgent) continue;
    if (
      oldTask &&
      oldTask.progressPercent === task.progressPercent &&
      oldTask.status === task.status &&
      oldTask.step === task.step
    ) continue;
    notifications.push({
      key: `task:${key}`,
      type: "task-progress",
      agent: task.activeAgent,
      taskTitle: task.title,
      taskStatus: task.status,
      taskStep: task.step,
      previousProgress: oldTask?.progressPercent,
      progress: task.progressPercent,
    });
  }

  return notifications.slice(0, 4);
}
