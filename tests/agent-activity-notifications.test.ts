import assert from "node:assert/strict";
import test from "node:test";
import {
  diffAgentActivityNotifications,
} from "../src/lib/agentActivityNotifications";
import type {
  AgentActivityEvent,
  AgentActivitySnapshot,
  TaskProgress,
} from "../src/types";

function event(state: string): AgentActivityEvent {
  return {
    id: `${state}-event`,
    agent: "codex",
    sessionId: "session-1",
    event: "PreToolUse",
    state,
    project: "/repo",
    taskId: "08-live",
    taskTitle: "Live task",
    taskStatus: "in_progress",
    taskProgress: 0.5,
    step: "implementing",
    toolName: "Bash",
    activity: "npm test",
    timestamp: 10,
  };
}

function task(
  progress: number | null,
  activeAgent: string | null = "codex",
  step: string | null = "implementing",
): TaskProgress {
  return {
    projectPath: "/repo",
    projectName: "repo",
    taskId: "08-live",
    title: "Live task",
    status: "in_progress",
    progress,
    step,
    updatedAt: 10,
    activeAgent,
    lastEvent: "PreToolUse",
    lastTool: "Bash",
    lastActivity: "npm test",
    lastActivityAt: 10,
  };
}

function snapshot(events: AgentActivityEvent[], tasks: TaskProgress[] = []): AgentActivitySnapshot {
  return { events, tasks };
}

test("first activity snapshot only establishes the baseline", () => {
  const current = snapshot([event("working")], [task(0.5)]);
  assert.deepEqual(
    diffAgentActivityNotifications(null, current, { hasBaseline: false }),
    [],
  );
});

test("agent state changes notify once and duplicate states stay silent", () => {
  const baseline = snapshot([event("working")]);
  const waiting = diffAgentActivityNotifications(
    baseline,
    snapshot([event("waiting")]),
    { hasBaseline: true },
  );
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].type, "agent-state");
  assert.equal(waiting[0].state, "waiting");

  assert.deepEqual(
    diffAgentActivityNotifications(
      snapshot([event("waiting")]),
      snapshot([event("waiting")]),
      { hasBaseline: true },
    ),
    [],
  );
});

test("task progress changes create a progress notification", () => {
  const notifications = diffAgentActivityNotifications(
    snapshot([event("working")], [task(0.5)]),
    snapshot([event("working")], [task(0.75)]),
    { hasBaseline: true },
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "task-progress");
  assert.equal(notifications[0].previousProgress, 50);
  assert.equal(notifications[0].progress, 75);
});

test("task step changes notify when progress is unknown", () => {
  const notifications = diffAgentActivityNotifications(
    snapshot([event("working")], [task(null, "codex", "implementing")]),
    snapshot([event("working")], [task(null, "codex", "verifying")]),
    { hasBaseline: true },
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "task-progress");
  assert.equal(notifications[0].progress, undefined);
  assert.equal(notifications[0].previousProgress, undefined);
  assert.equal(notifications[0].taskStep, "verifying");
});
