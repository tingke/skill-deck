import { create } from "zustand";
import type { Skill, AgentInfo, LibrarySource, SkillConnectionState, SharedDisconnectConfirmation, SkillDeleteConfirmation, AuditReport } from "../types";
import type { SkillFileEntry } from "../types";
import * as api from "../lib/tauri";
import { parseSharedDisconnectError } from "../lib/connectionConfirmation";
import { scanWorkspace, type ScanResource } from "../lib/scanning";
import { useToastStore } from "./toast";
import { useActivityStore } from "./activity";
import { useAssetsStore } from "./assets";
import { useExtensionsStore } from "./extensions";
import { tr } from "../i18n";

const toast = () => useToastStore.getState();
const refreshActivity = () => useActivityStore.getState().loadActivity();

// 连接类操作后的统一回刷：verify_connections 会校验 symlink 实际状态，
// 不能替换为只读 DB 的 loadSkills()
const refreshAfterConnectionOp = async (skillId?: string) => {
  const store = useSkillsStore.getState();
  const skills = await api.verifyConnections();
  useSkillsStore.setState({ skills });
  if (skillId && store.selectedSkillId === skillId) {
    await useSkillsStore.getState().loadSkillConnections(skillId);
  }
  refreshActivity();
};

interface SkillsState {
  skills: Skill[];
  agentOptions: AgentInfo[];
  skillConnections: SkillConnectionState[];
  connectionConfirmation: SharedDisconnectConfirmation | null;
  connectionConfirming: boolean;
  skillDeleteConfirmation: SkillDeleteConfirmation | null;
  skillDeleting: boolean;
  batchDeleteIds: string[] | null;
  batchDeleting: boolean;
  loading: boolean;
  globalScanning: boolean;
  selectedSkillId: string | null;
  /** 已检测出可更新的 skill id（跨视图保留，避免切页后角标丢失） */
  updatableSkillIds: Set<string>;
  setUpdatableSkillIds: (ids: Set<string>) => void;
  skillFiles: SkillFileEntry[];
  skillAudit: AuditReport | null;
  auditingSkill: boolean;
  loadSkills: () => Promise<void>;
  scanNow: () => Promise<void>;
  globalScan: () => Promise<void>;
  bootstrapScan: () => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  requestSkillDelete: (confirmation: SkillDeleteConfirmation) => void;
  cancelSkillDelete: () => void;
  confirmSkillDelete: () => Promise<void>;
  requestBatchDelete: (skillIds: string[]) => void;
  cancelBatchDelete: () => void;
  confirmBatchDelete: () => Promise<void>;
  updateTags: (skillId: string, tags: string[]) => Promise<void>;
  toggleSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>;
  toggleConnect: (skillId: string, agentId: string) => Promise<void>;
  loadAgentOptions: () => Promise<void>;
  loadSkillConnections: (skillId: string) => Promise<void>;
  adoptRealEntry: (skillId: string, agentId: string, librarySourceId: string) => Promise<void>;
  cancelSharedDisconnect: () => void;
  confirmSharedDisconnect: () => Promise<void>;
  requestBatchSharedDisconnect: (confirmation: SharedDisconnectConfirmation) => void;
  refreshAfterConnectionOp: (skillId?: string) => Promise<void>;
  verifyConnections: () => Promise<void>;
  selectSkill: (id: string | null) => void;
  loadSkillFiles: (id: string) => Promise<void>;
  loadSkillAudit: (id: string) => Promise<void>;
  runSkillAudit: (id: string) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  agentOptions: [],
  skillConnections: [],
  connectionConfirmation: null,
  connectionConfirming: false,
  skillDeleteConfirmation: null,
  skillDeleting: false,
  batchDeleteIds: null,
  batchDeleting: false,
  loading: false,
  globalScanning: false,
  selectedSkillId: null,
  updatableSkillIds: new Set<string>(),
  setUpdatableSkillIds: (ids) => set({ updatableSkillIds: ids }),
  skillFiles: [],
  skillAudit: null,
  auditingSkill: false,

  loadSkills: async () => {
    set({ loading: true });
    try {
      const skills = await api.getSkills();
      set({ skills, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  // 启动时静默扫描：不写活动日志、不弹 toast
  bootstrapScan: async () => {
    set({ loading: true });
    try {
      const skills = await api.scanAll(false);
      set({ skills, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  // 用户手动「扫描」：写活动日志 + toast + 刷新概览
  scanNow: async () => {
    set({ loading: true });
    try {
      const skills = await api.scanAll(true);
      set({ skills, loading: false });
      toast().show(tr("toast.scanDone", { count: skills.length }));
      refreshActivity();
    } catch {
      set({ loading: false });
      toast().show(tr("toast.scanFailed"), "error");
    }
  },

  globalScan: async () => {
    if (get().globalScanning) return;
    set({ globalScanning: true });
    const result = await scanWorkspace({
      scanSkills: () => api.scanAll(true),
      scanRules: () => api.scanRules(),
      scanExtensions: () => api.scanExt(),
    });
    set((state) => ({
      skills: result.skills ?? state.skills,
      globalScanning: false,
    }));
    if (result.rules) {
      useAssetsStore.setState({ rules: result.rules });
    }
    if (result.extensions) {
      useExtensionsStore.setState({ extensions: result.extensions });
    }

    if (result.failures.length > 0) {
      const labels: Record<ScanResource, string> = {
        skills: tr("nav.skills"),
        rules: tr("nav.rules"),
        extensions: tr("common.extensionsResource"),
      };
      toast().show(
        tr("common.globalScanFailed", { items: result.failures.map((item) => labels[item]).join("、") }),
        "error",
      );
    } else {
      toast().show(tr("common.globalScanDone", {
        skills: result.skills?.length ?? 0,
        rules: result.rules?.length ?? 0,
        extensions: result.extensions?.length ?? 0,
      }));
    }
    refreshActivity();
  },

  deleteSkill: async (skillId) => {
    await api.deleteSkill(skillId);
    set((state) => ({ skills: state.skills.filter((s) => s.id !== skillId) }));
    if (get().selectedSkillId === skillId) get().selectSkill(null);
    toast().show(tr("toast.skillDeleted"));
    refreshActivity();
  },

  updateTags: async (skillId, tags) => {
    try {
      await api.updateSkillTags(skillId, tags);
      set((state) => ({
        skills: state.skills.map((s) => (s.id === skillId ? { ...s, tags } : s)),
      }));
      toast().show(tr("toast.tagsUpdated"));
    } catch (error) {
      console.error(error);
      toast().show(tr("toast.tagsUpdateFailed"), "error");
    }
  },

  toggleSkillEnabled: async (skillId, enabled) => {
    await api.toggleSkillEnabled(skillId, enabled);
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled } : skill,
      ),
    }));
    if (get().selectedSkillId === skillId) {
      await get().loadSkillConnections(skillId);
    }
  },

  loadAgentOptions: async () => {
    try { set({ agentOptions: await api.getAgentOptions() }); } catch { /* ignore */ }
  },

  // 启动时的连接状态同步：校验 symlink 实际状态并回写 skills；
  // 仅在 App 引导链调用，保持静默（同 bootstrapScan，不弹 toast）
  verifyConnections: async () => {
    try {
      const skills = await api.verifyConnections();
      set({ skills });
    } catch {
      // 启动同步失败不打扰用户；连接类操作后的回刷走 refreshAfterConnectionOp
    }
  },

  toggleConnect: async (skillId, agentId) => {
    const state = get().skillConnections.find((connection) => connection.agent_id === agentId);
    const label = get().agentOptions.find((agent) => agent.id === agentId)?.label || agentId;
    try {
      if (state?.kind === "real_directory" || state?.kind === "real_file") {
        toast().show(tr("toast.realEntryBlocked"), "error");
        return;
      }
      if (state?.kind === "symlink") {
        try {
          await api.disconnectSkill(skillId, agentId, false);
        } catch (error) {
          const confirmation = parseSharedDisconnectError(error);
          if (!confirmation) throw error;
          set({
            connectionConfirmation: {
              ...confirmation,
              skillId,
              agentId,
              skillIds: [skillId],
            },
          });
          return;
        }
        toast().show(tr("toast.disconnectedAgent", { label }), "info");
      } else {
        await api.connectSkill(skillId, agentId);
        toast().show(tr("toast.connectedAgent", { label }));
      }
      await refreshAfterConnectionOp(skillId);
    } catch (e) {
      toast().show(tr("toast.failed"), "error");
      console.error(e);
    }
  },

  loadSkillConnections: async (skillId) => {
    try {
      const skillConnections = await api.getSkillConnections(skillId);
      if (get().selectedSkillId === skillId) set({ skillConnections });
    } catch { /* ignore */ }
  },

  adoptRealEntry: async (skillId, agentId, librarySourceId) => {
    try {
      await api.adoptRealEntry(skillId, agentId, librarySourceId);
      await refreshAfterConnectionOp(skillId);
      toast().show(tr("toast.adopted"));
    } catch (e) {
      toast().show(tr("toast.adoptFailed"), "error");
      console.error(e);
    }
  },

  cancelSharedDisconnect: () => {
    if (get().connectionConfirming) return;
    set({ connectionConfirmation: null });
  },

  confirmSharedDisconnect: async () => {
    const pending = get().connectionConfirmation;
    if (!pending || get().connectionConfirming) return;

    set({ connectionConfirming: true });
    try {
      if (pending.skillId) {
        await api.disconnectSkill(pending.skillId, pending.agentId, true);
        const label = get().agentOptions.find((agent) => agent.id === pending.agentId)?.label || pending.agentId;
        toast().show(tr("toast.disconnectedAgent", { label }), "info");
      } else {
        const failed = await api.batchConnect([], pending.skillIds, pending.agentId, true);
        const okCount = pending.skillIds.length - failed.length;
        if (failed.length === 0) {
          toast().show(tr("skills.detail.batchDisconnected", { count: pending.skillIds.length }), "info");
        } else if (okCount > 0) {
          toast().show(tr("skills.detail.batchDisconnectPartial", { ok: okCount, failed: failed.length }), "info");
        } else {
          toast().show(tr("skills.detail.batchDisconnectFailed"), "error");
        }
      }
      await refreshAfterConnectionOp();
    } catch (e) {
      toast().show(tr("toast.failed"), "error");
      console.error(e);
    } finally {
      set({ connectionConfirmation: null, connectionConfirming: false });
    }
  },

  requestBatchSharedDisconnect: (confirmation) => {
    set({ connectionConfirmation: confirmation });
  },

  refreshAfterConnectionOp: (skillId) => refreshAfterConnectionOp(skillId),

  requestSkillDelete: (confirmation) => {
    set({ skillDeleteConfirmation: confirmation });
  },

  cancelSkillDelete: () => {
    if (get().skillDeleting) return;
    set({ skillDeleteConfirmation: null });
  },

  confirmSkillDelete: async () => {
    const pending = get().skillDeleteConfirmation;
    if (!pending || get().skillDeleting) return;

    set({ skillDeleting: true });
    try {
      await get().deleteSkill(pending.id);
    } catch (e) {
      toast().show(tr("toast.deleteFailed"), "error");
      console.error(e);
    } finally {
      set({ skillDeleteConfirmation: null, skillDeleting: false });
    }
  },

  requestBatchDelete: (skillIds) => {
    set({ batchDeleteIds: skillIds });
  },

  cancelBatchDelete: () => {
    if (get().batchDeleting) return;
    set({ batchDeleteIds: null });
  },

  confirmBatchDelete: async () => {
    const pending = get().batchDeleteIds;
    if (!pending || get().batchDeleting) return;

    set({ batchDeleting: true });
    try {
      const failed = await api.batchDeleteSkills(pending);
      const okCount = pending.length - failed.length;
      set((state) => ({
        skills: state.skills.filter((s) => !pending.includes(s.id) || failed.includes(s.id)),
        batchDeleteIds: null,
      }));
      if (get().selectedSkillId && pending.includes(get().selectedSkillId!) && !failed.includes(get().selectedSkillId!)) {
        get().selectSkill(null);
      }
      if (failed.length > 0) {
        toast().show(tr("skills.batchDelete.failed", { count: failed.length }), "error");
      } else {
        toast().show(tr("skills.batchDelete.done", { count: okCount }));
      }
      refreshActivity();
    } catch (e) {
      toast().show(tr("toast.batchDeleteFailed"), "error");
      console.error(e);
    } finally {
      set({ batchDeleting: false });
    }
  },

  selectSkill: (id) => {
    set({ selectedSkillId: id, skillFiles: [], skillConnections: [], skillAudit: null });
    if (id) {
      get().loadSkillFiles(id);
      get().loadSkillConnections(id);
      get().loadSkillAudit(id);
    }
  },

  loadSkillFiles: async (id) => {
    try {
      const files = await api.listSkillFiles(id);
      set({ skillFiles: files });
    } catch { /* ignore */ }
  },

  loadSkillAudit: async (id) => {
    try {
      const report = await api.getSkillAudit(id);
      set({ skillAudit: report });
    } catch (error) {
      console.error(error);
      set({ skillAudit: null });
    }
  },

  runSkillAudit: async (id) => {
    if (get().auditingSkill) return;
    set({ auditingSkill: true });
    try {
      const report = await api.auditSkill(id);
      set((state) => ({
        skillAudit: report,
        auditingSkill: false,
        skills: state.skills.map((skill) =>
          skill.id === id ? { ...skill, audit_verdict: report.verdict } : skill,
        ),
      }));
      toast().show(
        report.verdict === "pass" ? tr("toast.auditPass") : report.verdict === "warn" ? tr("toast.auditWarn") : tr("toast.auditBlock"),
        report.verdict === "pass" ? "success" : "error",
      );
      refreshActivity();
    } catch (error) {
      set({ auditingSkill: false });
      console.error(error);
      toast().show(tr("toast.auditFailed"), "error");
    }
  },
}));
