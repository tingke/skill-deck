import type { SharedDisconnectConfirmation } from "../types";

const MARKER = "CONFIRM_SHARED:";

export function parseSharedDisconnectError(
  error: unknown,
): Omit<SharedDisconnectConfirmation, "skillId" | "skillIds" | "agentId"> | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(MARKER)) return null;

  const payload = message.slice(MARKER.length);
  const separator = payload.lastIndexOf(":");
  if (separator <= 0) return null;

  return {
    skillName: payload.slice(0, separator),
    affectedAgents: payload
      .slice(separator + 1)
      .split("、")
      .filter(Boolean),
  };
}

export function buildBatchSharedDisconnectConfirmation(
  error: unknown,
  skillIds: string[],
  agentId: string,
): SharedDisconnectConfirmation | null {
  const parsed = parseSharedDisconnectError(error);
  if (!parsed || skillIds.length === 0) return null;

  return {
    ...parsed,
    skillId: null,
    skillIds,
    agentId,
  };
}
