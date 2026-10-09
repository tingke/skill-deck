import assert from "node:assert/strict";
import test from "node:test";
import type { MarketplaceCatalog, MarketplaceInput } from "../src/types";
import {
  applyRequiredInputs,
  filterMarketplaceItems,
  hasInstalledMarketplaceMcp,
  hasInstalledMarketplaceSkill,
  marketplaceItems,
  parseMarketplaceMcpConfig,
} from "../src/lib/marketplace";

function catalog(): MarketplaceCatalog {
  return {
    source_kind: "manifest",
    source_url: "https://example.com/market.json",
    name: "Example",
    synced_at: "2026-09-15T00:00:00Z",
    skills: [{
      id: "example/design",
      name: "Design Skill",
      description: "Interface review",
      author: "example",
      tags: ["design", "review"],
      homepage: null,
      source: { kind: "git", source_ref: "https://github.com/example/skills", subdir: "skills/design" },
    }],
    mcps: [{
      id: "example/github",
      name: "GitHub MCP",
      server_name: "github",
      description: "GitHub integration",
      author: "example",
      tags: ["github", "developer"],
      version: "1.0.0",
      homepage: null,
      config: {
        command: "npx",
        args: ["-y", "example"],
        env: { GITHUB_TOKEN: "{{config.GITHUB_TOKEN}}" },
      },
      required_inputs: [{
        name: "GITHUB_TOKEN",
        description: "GitHub token",
        placeholder: "ghp_…",
        is_secret: true,
      }],
    }],
  };
}

test("marketplace filters by kind, query, and tag", () => {
  const items = marketplaceItems(catalog());
  assert.equal(items.length, 2);
  assert.deepEqual(
    filterMarketplaceItems(items, { query: "", kind: "skill", tag: null }).map((item) => item.kind),
    ["skill"],
  );
  assert.deepEqual(
    filterMarketplaceItems(items, { query: "github", kind: "all", tag: null }).map((item) => item.entry.id),
    ["example/github"],
  );
  assert.deepEqual(
    filterMarketplaceItems(items, { query: "", kind: "all", tag: "review" }).map((item) => item.entry.id),
    ["example/design"],
  );
  assert.equal(filterMarketplaceItems(items, { query: "missing", kind: "all", tag: null }).length, 0);
});

test("marketplace replaces nested required input placeholders and rejects missing values", () => {
  const config = catalog().mcps[0].config as Record<string, unknown>;
  const inputs: MarketplaceInput[] = catalog().mcps[0].required_inputs;
  const missing = applyRequiredInputs(config, inputs, {});
  assert.equal(missing.error, "missing:GITHUB_TOKEN");

  const applied = applyRequiredInputs(config, inputs, { GITHUB_TOKEN: "user-supplied-token" });
  assert.equal(applied.error, null);
  assert.deepEqual(applied.config, {
    command: "npx",
    args: ["-y", "example"],
    env: { GITHUB_TOKEN: "user-supplied-token" },
  });
});

test("marketplace does not require an input removed from edited MCP JSON", () => {
  const config = {
    command: "npx",
    args: ["-y", "example"],
    env: {},
  };
  const applied = applyRequiredInputs(
    config,
    [
      {
        name: "GITHUB_TOKEN",
        description: "GitHub token",
        placeholder: "",
        is_secret: true,
      },
    ],
    {},
  );
  assert.equal(applied.error, null);
  assert.deepEqual(applied.config, config);
});

test("marketplace MCP parser accepts one config object and rejects invalid JSON", () => {
  assert.equal(parseMarketplaceMcpConfig('{"command":"npx"}').error, null);
  assert.equal(parseMarketplaceMcpConfig("{bad").error, "invalid-json");
  assert.equal(parseMarketplaceMcpConfig("[]").error, "server-object-required");
  assert.equal(parseMarketplaceMcpConfig("null").error, "server-object-required");
});

test("marketplace detects installed entries without overwriting them silently", () => {
  const data = catalog();
  assert.equal(hasInstalledMarketplaceSkill([{ name: "design skill" }], data.skills[0]), true);
  assert.equal(hasInstalledMarketplaceSkill([{ name: "other" }], data.skills[0]), false);
  const extensions = [
    { kind: "mcp", runtime: "claude", name: "github" },
    { kind: "mcp", runtime: "codex", name: "github" },
  ];
  assert.equal(hasInstalledMarketplaceMcp(extensions, data.mcps[0], "codex"), true);
  assert.equal(hasInstalledMarketplaceMcp(extensions, data.mcps[0], "workbuddy"), false);
});
