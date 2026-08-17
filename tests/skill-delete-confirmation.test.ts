import assert from "node:assert/strict";
import test from "node:test";

test("skill deletion uses an explicit pending confirmation object", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  } as Storage;
  const { useAppStore } = await import("../src/stores/app");

  assert.equal(useAppStore.getState().skillDeleteConfirmation, null);

  useAppStore.getState().requestSkillDelete({
    id: "skill-1",
    name: "Example Skill",
    path: "/tmp/example-skill",
  });
  assert.deepEqual(useAppStore.getState().skillDeleteConfirmation, {
    id: "skill-1",
    name: "Example Skill",
    path: "/tmp/example-skill",
  });

  useAppStore.getState().cancelSkillDelete();
  assert.equal(useAppStore.getState().skillDeleteConfirmation, null);
});
