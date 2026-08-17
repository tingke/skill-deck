import assert from "node:assert/strict";
import test from "node:test";
import { scanWorkspace } from "../src/lib/scanning";

test("scan workspace runs each scanner in order and returns successful results", async () => {
  const calls: string[] = [];
  const result = await scanWorkspace({
    scanSkills: async () => {
      calls.push("skills");
      return [{ id: "skill-1" }] as never;
    },
    scanRules: async () => {
      calls.push("rules");
      return [{ id: 1 }] as never;
    },
    scanExtensions: async () => {
      calls.push("extensions");
      return [{ id: "mcp-1" }] as never;
    },
  });

  assert.deepEqual(calls, ["skills", "rules", "extensions"]);
  assert.equal(result.skills?.length, 1);
  assert.equal(result.rules?.length, 1);
  assert.equal(result.extensions?.length, 1);
  assert.deepEqual(result.failures, []);
});

test("scan workspace continues after a scanner fails", async () => {
  const calls: string[] = [];
  const result = await scanWorkspace({
    scanSkills: async () => {
      calls.push("skills");
      throw new Error("skills unavailable");
    },
    scanRules: async () => {
      calls.push("rules");
      return [] as never;
    },
    scanExtensions: async () => {
      calls.push("extensions");
      return [] as never;
    },
  });

  assert.deepEqual(calls, ["skills", "rules", "extensions"]);
  assert.equal(result.skills, undefined);
  assert.equal(result.rules?.length, 0);
  assert.equal(result.extensions?.length, 0);
  assert.deepEqual(result.failures, ["skills"]);
});
