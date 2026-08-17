import assert from "node:assert/strict";
import test from "node:test";
import { getDisconnectableSkillIds } from "../src/lib/skillBatch";
import type { Skill } from "../src/types";

const skill = (id: string, links: string[]): Skill => ({
  id,
  name: id,
  source_lib: "library",
  path: `/tmp/${id}`,
  description: "",
  content_hash: id,
  tags: [],
  links,
  enabled: true,
  author: "",
  license: "",
  version: "",
  permissions: [],
});

test("batch disconnect only includes connected selected skills", () => {
  const skills = [
    skill("selected-connected", ["codex"]),
    skill("selected-unconnected", []),
    skill("unselected-connected", ["codex"]),
  ];

  assert.deepEqual(
    getDisconnectableSkillIds(
      skills,
      new Set(["selected-connected", "selected-unconnected"]),
      "codex",
    ),
    ["selected-connected"],
  );
});
