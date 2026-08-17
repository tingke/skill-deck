import type { Skill } from "../types";

export function getDisconnectableSkillIds(
  skills: Skill[],
  selectedIds: Set<string>,
  agentId: string,
): string[] {
  return skills
    .filter((skill) => selectedIds.has(skill.id) && skill.links.includes(agentId))
    .map((skill) => skill.id);
}
