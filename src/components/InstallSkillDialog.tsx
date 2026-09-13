import { useEffect, useState } from "react";
import { Download, GitBranch, FolderInput, Package, Loader2, TriangleAlert } from "lucide-react";
import type { InstallResult, LibrarySource, SkillSourceKind } from "../types";
import { installSkill } from "../lib/tauri";
import { INSTALL_STATUS_META, needsUserConfirm } from "../lib/skillAudit";
import { useSkillsStore } from "../stores/skills";
import { useActivityStore } from "../stores/activity";
import { useToastStore } from "../stores/toast";
import AuditFindings from "./AuditFindings";

const KIND_OPTIONS: { value: SkillSourceKind; label: string; placeholder: string }[] = [
  { value: "git", label: "Git 仓库", placeholder: "https://github.com/user/skill-repo" },
  { value: "archive", label: "Zip 压缩包", placeholder: "~/Downloads/skill.zip" },
  { value: "path", label: "本地目录", placeholder: "~/Documents/skills/my-skill" },
];

export default function InstallSkillDialog({
  open,
  onClose,
  librarySources,
}: {
  open: boolean;
  onClose: () => void;
  librarySources: LibrarySource[];
}) {
  const [kind, setKind] = useState<SkillSourceKind>("git");
  const [sourceRef, setSourceRef] = useState("");
  const [librarySourceId, setLibrarySourceId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);

  const enabledLibraries = librarySources.filter((lib) => lib.enabled);

  useEffect(() => {
    if (open) {
      setSourceRef("");
      setResult(null);
      if (!librarySourceId && enabledLibraries.length > 0) {
        setLibrarySourceId(enabledLibraries[0].id);
      }
    }
  }, [open]);

  if (!open) return null;

  const kindOption = KIND_OPTIONS.find((option) => option.value === kind);

  const runInstall = async (overrideAudit: boolean) => {
    if (installing || !sourceRef.trim() || !librarySourceId) return;
    setInstalling(true);
    setResult(null);
    try {
      const installResult = await installSkill(
        { kind, source_ref: sourceRef.trim() },
        librarySourceId,
        overrideAudit,
      );
      setResult(installResult);
      if (installResult.status === "installed") {
        useToastStore.getState().show(`已安装 ${installResult.skill_name}`);
        await useSkillsStore.getState().loadSkills();
        await useActivityStore.getState().loadActivity();
        onClose();
      }
    } catch (error) {
      console.error(error);
      useToastStore.getState().show(
        error instanceof Error ? error.message : "安装失败",
        "error",
      );
    } finally {
      setInstalling(false);
    }
  };

  const KindIcon = kind === "git" ? GitBranch : kind === "archive" ? Package : FolderInput;

  return (
    <div
      className="connection-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !installing) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-skill-title"
        data-testid="install-skill-dialog"
        className="install-dialog"
      >
        <div className="flex items-center gap-2">
          <div className="connection-dialog-icon" style={{ color: "rgb(139 92 246)", background: "rgb(139 92 246 / 0.1)" }}>
            <Download size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="install-skill-title" className="connection-dialog-title">安装 Skill</h3>
            <p className="connection-dialog-message" style={{ margin: 0 }}>
              来源会先进入暂存目录完成安全审查，再安装到库源
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">来源类型</span>
            <div className="flex items-center gap-1.5">
              {KIND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKind(option.value)}
                  className={"btn btn-sm " + (kind === option.value ? "btn-primary" : "btn-outline")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">
              {kind === "git" ? "仓库地址" : kind === "archive" ? "压缩包路径" : "目录路径"}
            </span>
            <div className="flex items-center gap-2">
              <KindIcon size={14} className="text-faint shrink-0" />
              <input
                value={sourceRef}
                onChange={(event) => setSourceRef(event.target.value)}
                placeholder={kindOption?.placeholder}
                className="input"
                autoFocus
              />
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">安装到库源</span>
            <select
              value={librarySourceId}
              onChange={(event) => setLibrarySourceId(event.target.value)}
              className="input"
            >
              {enabledLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </label>
        </div>

        {result && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-heading">
                  {INSTALL_STATUS_META[result.status]?.label ?? result.status}
                </div>
                <div className="text-2xs text-muted">{result.message}</div>
                {result.status !== "conflict" && (
                  <div className="text-2xs text-faint font-mono truncate" title={result.target_path}>
                    {result.target_path}
                  </div>
                )}
              </div>
            </div>
            {result.report && result.report.findings.length > 0 && (
              <AuditFindings findings={result.report.findings} />
            )}
            {needsUserConfirm(result.status) && (
              <button
                type="button"
                onClick={() => runInstall(true)}
                disabled={installing}
                className="btn btn-danger btn-sm w-full"
              >
                {installing ? <Loader2 size={13} className="animate-spin" /> : <TriangleAlert size={13} />}
                我已了解风险，仍要安装
              </button>
            )}
          </div>
        )}

        <div className="connection-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={installing} autoFocus>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => runInstall(false)}
            disabled={installing || !sourceRef.trim() || !librarySourceId}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            安装
          </button>
        </div>
      </div>
    </div>
  );
}
