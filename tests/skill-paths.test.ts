import assert from "node:assert/strict";
import test from "node:test";
import { formatSkillPath } from "../src/lib/skillPaths";

test("formats paths under the home directory with a tilde", () => {
  assert.equal(
    formatSkillPath("/Users/tingke/.agents/skills/brainstorming", "/Users/tingke"),
    "~/.agents/skills/brainstorming",
  );
  assert.equal(formatSkillPath("/Users/tingke", "/Users/tingke"), "~");
  assert.equal(
    formatSkillPath("/tmp/skills/example", "/Users/tingke"),
    "/tmp/skills/example",
  );
});
