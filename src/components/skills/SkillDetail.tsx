import { useState, useMemo, useEffect } from "react";
import {
  FolderClosed, FilePen, Link2,
  User, Layers, Scale, Tag as TagIcon,
  ArchiveRestore, Loader2, Cpu, Globe,
  FileText, Settings as SettingsIcon,
} from "lucide-react";
import type { Skill, AgentInfo, SkillFileEntry, SkillConnectionState } from "../../types";
import { revealInFinder, readSkillFileByPath, getHomeDirectory } from "../../lib/tauri";
import { formatSkillPath } from "../../lib/skillPaths";
import { useSkillsStore } from "../../stores/skills";
import { useWorkspaceStore } from "../../stores/workspace";
import { useT } from "../../i18n";
import { AgentGlyph } from "../AgentGlyph";
import { TagEditor } from "./TagEditor";
import { DetailFileTree } from "./DetailFileTree";
import { SkillAuditSection } from "./SkillAuditSection";
import { SkillUpdateSection } from "./SkillUpdateSection";

const PERM_ICONS: Record<string, { icon: typeof Cpu; labelKey: "skills.perm.exec" | "skills.perm.write" | "skills.perm.network"; color: string }> = {
  "exec": { icon: Cpu, labelKey: "skills.perm.exec", color: "text-amber-500" },
  "file:write": { icon: FilePen, labelKey: "skills.perm.write", color: "text-blue-500" },
  "network": { icon: Globe, labelKey: "skills.perm.network", color: "text-accent" },
};

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="skill-toggle" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="skill-toggle-slider" />
    </label>
  );
}

export function SkillDetail() {
  const t = useT();
  const {
    selectedSkillId, skills, agentOptions, skillConnections,
    skillFiles, toggleConnect, adoptRealEntry,
  } = useSkillsStore();
  const librarySources = useWorkspaceStore((s) => s.librarySources);
  const [adoptionAgentId, setAdoptionAgentId] = useState<string | null>(null);
  const [adoptionSourceId, setAdoptionSourceId] = useState("");
  const [homeDirectory, setHomeDirectory] = useState("");
  const [tab, setTab] = useState<"files" | "settings">("files");
  const [openFile, setOpenFile] = useState<SkillFileEntry | null>(null);
  const [openContent, setOpenContent] = useState("");
  const [openLoading, setOpenLoading] = useState(false);

  const skill = skills.find((s) => s.id === selectedSkillId);

  useEffect(() => {
    let active = true;
    getHomeDirectory()
      .then((home) => {
        if (active) setHomeDirectory(home);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const flatFiles = useMemo(() => {
    const out: SkillFileEntry[] = [];
    const walk = (entries: SkillFileEntry[]) =>
      entries.forEach((entry) => {
        if (entry.is_dir) walk(entry.children);
        else out.push(entry);
      });
    walk(skillFiles);
    return out;
  }, [skillFiles]);

  const selectFile = async (entry: SkillFileEntry) => {
    setOpenFile(entry);
    setOpenLoading(true);
    try {
      setOpenContent(await readSkillFileByPath(skill!.id, entry.path));
    } catch {
      setOpenContent(t("skills.detail.loadFailed"));
    } finally {
      setOpenLoading(false);
    }
  };

  // 切换技能时重置文件选择；文件列表就绪后默认选中 SKILL.md（无则第一个文件）
  useEffect(() => {
    setOpenFile(null);
    setOpenContent("");
  }, [skill?.id]);

  useEffect(() => {
    if (openFile || flatFiles.length === 0) return;
    const preferred =
      flatFiles.find((entry) => entry.name.toUpperCase() === "SKILL.MD") ?? flatFiles[0];
    selectFile(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatFiles]);

  if (!skill) {
    return null;
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className={tab === "files" ? "flex-1 min-h-0" : "flex-1 overflow-y-auto"}>
        {tab === "files" ? (
          <div className="h-full flex flex-col px-4 py-2">
            <div className="flex items-center gap-1.5 mb-2 shrink-0">
              <FolderClosed size={12} className="text-faint" />
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("skills.detail.files")}</span>
            </div>
            {flatFiles.length === 0 ? (
              <div className="text-xs text-faint py-2">{t("skills.detail.noFiles")}</div>
            ) : (
              <div className="rounded-lg border border-border-subtle p-1.5 overflow-y-auto max-h-[20%] shrink-0">
                <DetailFileTree
                  entries={skillFiles}
                  depth={0}
                  activePath={openFile?.path}
                  onSelect={selectFile}
                />
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-2 mt-3 shrink-0 min-w-0">
              <FilePen size={12} className="text-faint shrink-0" />
              <span className="text-2xs font-semibold text-faint uppercase tracking-wider shrink-0">{t("skills.detail.fileContent")}</span>
              {openFile && <span className="text-2xs text-faint font-mono truncate">{openFile.path}</span>}
            </div>
            {openLoading ? (
              <div className="flex items-center gap-1.5 py-3 text-2xs text-faint">
                <Loader2 size={11} className="animate-spin" /> {t("skills.detail.loading")}
              </div>
            ) : openFile ? (
              <pre className="flex-1 min-h-0 text-2xs font-mono text-muted whitespace-pre-wrap break-words leading-relaxed rounded-lg border border-border-subtle bg-surface-2 p-3 overflow-y-auto">
                {openContent}
              </pre>
            ) : (
              <div className="text-xs text-faint py-2">{t("skills.detail.selectFileHint")}</div>
            )}
          </div>
        ) : (
          <>
            {/* metadata: author / license */}
            {(skill.author || skill.license || skill.version) && (
              <div className="px-5 py-3 border-b border-border-subtle space-y-1.5">
                {skill.author && (
                  <div className="flex items-center gap-2 text-xs">
                    <User size={12} className="text-faint shrink-0" />
                    <span className="text-faint shrink-0">{t("skills.detail.author")}</span>
                    <span className="text-muted truncate">{skill.author}</span>
                  </div>
                )}
                {skill.version && (
                  <div className="flex items-center gap-2 text-xs">
                    <Layers size={12} className="text-faint shrink-0" />
                    <span className="text-faint shrink-0">{t("skills.detail.version")}</span>
                    <span className="text-muted font-mono truncate">{skill.version}</span>
                  </div>
                )}
                {skill.license && (
                  <div className="flex items-center gap-2 text-xs">
                    <Scale size={12} className="text-faint shrink-0" />
                    <span className="text-faint shrink-0">{t("skills.detail.license")}</span>
                    <span className="text-muted truncate">{skill.license}</span>
                  </div>
                )}
              </div>
            )}

            {/* tags */}
            <div className="px-5 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-1.5 mb-2">
                <TagIcon size={12} className="text-faint" />
                <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("skills.detail.tags")}</span>
              </div>
              <TagEditor skillId={skill.id} tags={skill.tags} />
            </div>

            {/* Agent connections */}
            <div className="px-5 py-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Link2 size={12} className="text-faint" />
                <span className="text-2xs font-semibold text-faint uppercase tracking-wider">
                  {t("skills.detail.wiring", { used: skill.links.length, total: agentOptions.length })}
                </span>
              </div>
              <div>
                {agentOptions.map((agent, idx) => {
                  const connection = skillConnections.find((item) => item.agent_id === agent.id);
                  const isReal = connection?.kind === "real_directory" || connection?.kind === "real_file";
                  const linked = Boolean(connection);
                  return (
                    <div
                      key={agent.id}
                      className={
                        "py-2" + (idx < agentOptions.length - 1 ? " border-b border-border-subtle" : "")
                      }
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AgentGlyph
                          id={agent.id}
                          label={agent.label}
                          size={22}
                          active={linked}
                        />
                        <span className={"text-xs font-medium shrink-0 " + (linked ? "text-content" : "text-faint")}>
                          {agent.label}
                        </span>
                        {connection && (
                          <button
                            data-testid="connection-path-button"
                            onClick={() => revealInFinder(connection.entry_path)}
                            className="ml-auto min-w-0 flex items-center gap-1 text-2xs text-faint font-mono transition-colors hover:text-accent"
                            title={`${connection.entry_path} · ${t("skills.detail.showInFinder")}`}
                          >
                            <span className="min-w-0 truncate">
                              {formatSkillPath(connection.entry_path, homeDirectory)}
                            </span>
                          </button>
                        )}
                        <div className={"shrink-0 flex items-center gap-1.5 " + (connection ? "" : "ml-auto")} onClick={(e) => e.stopPropagation()}>
                          {isReal && (
                            <button
                              onClick={() => {
                                setAdoptionAgentId(adoptionAgentId === agent.id ? null : agent.id);
                                setAdoptionSourceId("");
                              }}
                              className="btn btn-outline btn-sm text-amber-600"
                              title={t("skills.detail.adopt")}
                            >
                              <ArchiveRestore size={12} />
                            </button>
                          )}
                          <MiniToggle
                            checked={linked}
                            onChange={() => toggleConnect(skill.id, agent.id)}
                          />
                        </div>
                      </div>
                      {isReal && adoptionAgentId === agent.id && (
                        <div className="flex items-center gap-1.5 pl-[30px] mt-1.5">
                          <select
                            value={adoptionSourceId}
                            onChange={(event) => setAdoptionSourceId(event.target.value)}
                            className="input w-auto min-w-[140px]"
                          >
                            <option value="">{t("skills.detail.adoptPickSource")}</option>
                            {librarySources.filter((source) => source.enabled).map((source) => (
                              <option key={source.id} value={source.id}>{source.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              if (!adoptionSourceId) return;
                              adoptRealEntry(skill.id, agent.id, adoptionSourceId);
                              setAdoptionAgentId(null);
                              setAdoptionSourceId("");
                            }}
                            disabled={!adoptionSourceId}
                            className="btn btn-primary btn-sm"
                          >
                            {t("skills.detail.adoptConfirm")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* permissions */}
            <div className="px-5 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-1.5 mb-2">
                <FilePen size={12} className="text-faint" />
                <span className="text-2xs font-semibold text-faint uppercase tracking-wider">{t("skills.detail.permissions")}</span>
              </div>
              {skill.permissions.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {skill.permissions.map((p) => {
                    const cfg = PERM_ICONS[p];
                    if (!cfg) {
                      return (
                        <span key={p} className="text-2xs px-2 py-0.5 rounded-md bg-surface-2 font-medium font-mono">
                          {p}
                        </span>
                      );
                    }
                    const Icon = cfg.icon;
                    return (
                      <span key={p} className="flex items-center gap-1 text-2xs px-2 py-0.5 rounded-md bg-surface-2 font-medium">
                        <Icon size={10} className={cfg.color} /> {t(cfg.labelKey)}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="text-2xs text-faint">{t("skills.detail.noPermissions")}</span>
              )}
            </div>

            {/* audit */}
            <SkillAuditSection skill={skill} />

            {/* origin & updates */}
            <SkillUpdateSection skill={skill} agentOptions={agentOptions} />
          </>
        )}
      </div>

      {/* tab 切换（底部浮动胶囊） */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface p-1 shadow-lg">
          {(["files", "settings"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-label={key === "files" ? t("skills.detail.filesTab") : t("skills.detail.settings")}
              title={key === "files" ? t("skills.detail.filesTab") : t("skills.detail.settings")}
              className={
                "inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors " +
                (tab === key ? "bg-heading text-page" : "text-muted hover:bg-surface-hover")
              }
            >
              {key === "files" ? <FileText size={14} /> : <SettingsIcon size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
