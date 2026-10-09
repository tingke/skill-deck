import type {
  MarketplaceCatalog,
  MarketplaceInput,
  MarketplaceMcp,
  MarketplaceSkill,
} from "../types";

export const DEFAULT_MCP_REGISTRY_URL =
  "https://registry.modelcontextprotocol.io/v0.1/servers";

export type MarketplaceKind = "all" | "skill" | "mcp";

export type MarketplaceItem =
  | { kind: "skill"; entry: MarketplaceSkill }
  | { kind: "mcp"; entry: MarketplaceMcp };

export interface MarketplaceFilter {
  query: string;
  kind: MarketplaceKind;
  tag: string | null;
}

export function marketplaceItems(catalog: MarketplaceCatalog | null): MarketplaceItem[] {
  if (!catalog) return [];
  return [
    ...catalog.skills.map((entry) => ({ kind: "skill" as const, entry })),
    ...catalog.mcps.map((entry) => ({ kind: "mcp" as const, entry })),
  ];
}

export function filterMarketplaceItems(
  items: MarketplaceItem[],
  filter: MarketplaceFilter,
): MarketplaceItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kind !== "all" && item.kind !== filter.kind) return false;
    if (filter.tag && !item.entry.tags.includes(filter.tag)) return false;
    if (!query) return true;
    const haystack = [
      item.entry.name,
      item.entry.description,
      item.entry.author,
      item.entry.id,
      ...item.entry.tags,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function inputPlaceholder(name: string): string {
  return `{{config.${name}}}`;
}

function replaceValue(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    let current = value;
    for (const [name, replacement] of Object.entries(values)) {
      current = current.replaceAll(inputPlaceholder(name), replacement);
    }
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceValue(item, values)]),
    );
  }
  return value;
}

export function applyRequiredInputs(
  config: Record<string, unknown>,
  inputs: MarketplaceInput[],
  values: Record<string, string>,
): { config: Record<string, unknown> | null; error: string | null } {
  const configText = JSON.stringify(config);
  const usedInputs = inputs.filter((input) =>
    configText.includes(inputPlaceholder(input.name)),
  );
  const missing = usedInputs.filter((input) => !values[input.name]?.trim());
  if (missing.length > 0) {
    return { config: null, error: `missing:${missing.map((input) => input.name).join(",")}` };
  }
  const replaced = replaceValue(config, values) as Record<string, unknown>;
  if (JSON.stringify(replaced).includes("{{config.")) {
    return { config: null, error: "unresolved-placeholder" };
  }
  return { config: replaced, error: null };
}

export function parseMarketplaceMcpConfig(text: string): {
  config: Record<string, unknown> | null;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { config: null, error: "invalid-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { config: null, error: "server-object-required" };
  }
  return { config: parsed as Record<string, unknown>, error: null };
}

export function hasInstalledMarketplaceSkill(
  skills: { name: string }[],
  entry: MarketplaceSkill,
): boolean {
  const name = entry.name.trim().toLowerCase();
  return skills.some((skill) => skill.name.trim().toLowerCase() === name);
}

export function hasInstalledMarketplaceMcp(
  extensions: { kind: string; runtime: string; name: string }[],
  entry: MarketplaceMcp,
  runtime: string,
): boolean {
  return extensions.some(
    (extension) =>
      extension.kind === "mcp" &&
      extension.runtime === runtime &&
      extension.name === entry.server_name,
  );
}
