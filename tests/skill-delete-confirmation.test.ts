import assert from "node:assert/strict";
import test from "node:test";

test("skill deletion uses an explicit pending confirmation object", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  } as Storage;
  const { useSkillsStore } = await import("../src/stores/skills");

  assert.equal(useSkillsStore.getState().skillDeleteConfirmation, null);

  useSkillsStore.getState().requestSkillDelete({
    id: "skill-1",
    name: "Example Skill",
    path: "/tmp/example-skill",
  });
  assert.deepEqual(useSkillsStore.getState().skillDeleteConfirmation, {
    id: "skill-1",
    name: "Example Skill",
    path: "/tmp/example-skill",
  });

  useSkillsStore.getState().cancelSkillDelete();
  assert.equal(useSkillsStore.getState().skillDeleteConfirmation, null);
});
