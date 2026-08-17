import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatchSharedDisconnectConfirmation,
  parseSharedDisconnectError,
} from "../src/lib/connectionConfirmation";

test("parses the shared disconnect confirmation payload", () => {
  const result = parseSharedDisconnectError("CONFIRM_SHARED:generate-prd:Codex、Cursor、Trae");

  assert.deepEqual(result, {
    skillName: "generate-prd",
    affectedAgents: ["Codex", "Cursor", "Trae"],
  });
});

test("rejects ordinary command errors", () => {
  assert.equal(parseSharedDisconnectError("Agent codex 未连接 skill"), null);
  assert.equal(parseSharedDisconnectError(new Error("operation failed")), null);
});

test("builds a retryable batch shared disconnect confirmation", () => {
  assert.deepEqual(
    buildBatchSharedDisconnectConfirmation(
      "CONFIRM_SHARED:brainstorming:Codex、Trae、Opencode、WorkBuddy",
      ["skill-1", "skill-2"],
      "codex",
    ),
    {
      skillId: null,
      skillIds: ["skill-1", "skill-2"],
      agentId: "codex",
      skillName: "brainstorming",
      affectedAgents: ["Codex", "Trae", "Opencode", "WorkBuddy"],
    },
  );
});
