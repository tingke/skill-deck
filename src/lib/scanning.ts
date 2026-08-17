import type { ExtensionRow, Rule, Skill } from "../types";

export type ScanResource = "skills" | "rules" | "extensions";

export interface WorkspaceScanApis {
  scanSkills: () => Promise<Skill[]>;
  scanRules: () => Promise<Rule[]>;
  scanExtensions: () => Promise<ExtensionRow[]>;
}

export interface WorkspaceScanResult {
  skills?: Skill[];
  rules?: Rule[];
  extensions?: ExtensionRow[];
  failures: ScanResource[];
}

export async function scanWorkspace(apis: WorkspaceScanApis): Promise<WorkspaceScanResult> {
  const result: WorkspaceScanResult = { failures: [] };

  try {
    result.skills = await apis.scanSkills();
  } catch {
    result.failures.push("skills");
  }

  try {
    result.rules = await apis.scanRules();
  } catch {
    result.failures.push("rules");
  }

  try {
    result.extensions = await apis.scanExtensions();
  } catch {
    result.failures.push("extensions");
  }

  return result;
}
