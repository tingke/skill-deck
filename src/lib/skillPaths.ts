export function formatSkillPath(path: string, homeDirectory: string): string {
  if (!homeDirectory) return path;
  if (path === homeDirectory) return "~";
  const prefix = `${homeDirectory}/`;
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}
