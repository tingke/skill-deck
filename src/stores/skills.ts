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

interface SkillsState {
  skills: Skill[];
  agentOptions: AgentInfo[];
  skillConnections: SkillConnectionState[];
  connectionConfirmation: SharedDisconnectConfirmation | null;
  connectionConfirming: boolean;
  skillDeleteConfirmation: SkillDeleteConfirmation | null;
  skillDeleting: boolean;
  loading: boolean;
  globalScanning: boolean;
  selectedSkillId: string | null;
  skillContent: string;
  loadingContent: boolean;
  skillFiles: SkillFileEntry[];
  selectedFilePath: string | null;
  selectedFileContent: string;
  editingSkill: boolean;
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
  updateTags: (skillId: string, tags: string[]) => Promise<void>;
  toggleSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>;
  toggleConnect: (skillId: string, agentId: string) => Promise<void>;
  loadAgentOptions: () => Promise<void>;
  loadSkillConnections: (skillId: string) => Promise<void>;
  adoptRealEntry: (skillId: string, agentId: string, librarySourceId: string) => Promise<void>;
  cancelSharedDisconnect: () => void;
  confirmSharedDisconnect: () => Promise<void>;
  requestBatchSharedDisconnect: (confirmation: SharedDisconnectConfirmation) => void;
  verifyConnections: () => Promise<void>;
  selectSkill: (id: string | null) => void;
  loadSkillContent: (id: string) => Promise<void>;
  loadSkillFiles: (id: string) => Promise<void>;
  loadFileContent: (skillId: string, filePath: string) => Promise<void>;
  saveSkillContent: (id: string, content: string) => Promise<void>;
  setEditingSkill: (v: boolean) => void;
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
  loading: false,
  globalScanning: false,
  selectedSkillId: null,
  skillContent: "",
  loadingContent: false,
  skillFiles: [],
  selectedFilePath: null,
  selectedFileContent: "",
  editingSkill: false,
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
      toast().show(`扫描完成，${skills.length} 个 skill`);
      refreshActivity();
    } catch {
      set({ loading: false });
      toast().show("扫描失败", "error");
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
    toast().show("Skill 已删除");
    refreshActivity();
  },

  updateTags: async (skillId, tags) => {
    await api.updateSkillTags(skillId, tags);
    set((state) => ({
      skills: state.skills.map((s) => (s.id === skillId ? { ...s, tags } : s)),
    }));
    toast().show("标签已更新");
  },

  toggleSkillEnabled: async (skillId, enabled) => {
    await api.toggleSkillEnabled(skillId, enabled);
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled } : skill,
      ),
    }));
    if (get().selectedSkillId === skillId) {
      await get().loadSkillContent(skillId);
      await get().loadSkillConnections(skillId);
    }
  },

  loadAgentOptions: async () => {
    try { set({ agentOptions: await api.getAgentOptions() }); } catch { /* ignore */ }
  },

  verifyConnections: async () => {
    try {
      const skills = await api.verifyConnections();
      set({ skills });
      toast().show("已同步连接状态");
    } catch {
      toast().show("同步失败", "error");
    }
  },

  toggleConnect: async (skillId, agentId) => {
    const state = get().skillConnections.find((connection) => connection.agent_id === agentId);
    const label = get().agentOptions.find((agent) => agent.id === agentId)?.label || agentId;
    try {
      if (state?.kind === "real_directory" || state?.kind === "real_file") {
        toast().show("检测到真实入口，请先收纳到库源", "error");
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
        toast().show(`已断开 ${label}`, "info");
      } else {
        await api.connectSkill(skillId, agentId);
        toast().show(`已连接到 ${label}`);
      }
      const skills = await api.verifyConnections();
      set({ skills });
      await get().loadSkillConnections(skillId);
      refreshActivity();
    } catch (e) {
      toast().show("操作失败", "error");
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
      const skills = await api.verifyConnections();
      set({ skills });
      await get().loadSkillConnections(skillId);
      refreshActivity();
      toast().show("真实入口已移动到库源，并保留软链");
    } catch (e) {
      toast().show("收纳失败", "error");
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
        toast().show(`已断开 ${label}`, "info");
      } else {
        await api.batchConnect([], pending.skillIds, pending.agentId, true);
        toast().show(`已断开 ${pending.skillIds.length} 个 Skill`, "info");
      }
      const skills = await api.verifyConnections();
      set({ skills });
      const selectedSkillId = get().selectedSkillId;
      if (selectedSkillId) {
        await get().loadSkillConnections(selectedSkillId);
      }
      refreshActivity();
    } catch (e) {
      toast().show("操作失败", "error");
      console.error(e);
    } finally {
      set({ connectionConfirmation: null, connectionConfirming: false });
    }
  },

  requestBatchSharedDisconnect: (confirmation) => {
    set({ connectionConfirmation: confirmation });
  },

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
      toast().show("删除失败", "error");
      console.error(e);
    } finally {
      set({ skillDeleteConfirmation: null, skillDeleting: false });
    }
  },

  selectSkill: (id) => {
    set({ selectedSkillId: id, skillContent: "", skillFiles: [], skillConnections: [], selectedFilePath: null, selectedFileContent: "", editingSkill: false, skillAudit: null });
    if (id) {
      get().loadSkillContent(id);
      get().loadSkillFiles(id);
      get().loadSkillConnections(id);
      get().loadSkillAudit(id);
    }
  },

  loadSkillContent: async (id) => {
    set({ loadingContent: true });
    try {
      const content = await api.readSkillFile(id);
      set({ skillContent: content, loadingContent: false });
    } catch {
      set({ skillContent: "（无法读取 SKILL.md）", loadingContent: false });
    }
  },

  loadSkillFiles: async (id) => {
    try {
      const files = await api.listSkillFiles(id);
      set({ skillFiles: files });
    } catch { /* ignore */ }
  },

  loadFileContent: async (skillId, filePath) => {
    set({ selectedFilePath: filePath, selectedFileContent: "" });
    try {
      const content = await api.readSkillFileByPath(skillId, filePath);
      set({ selectedFileContent: content });
    } catch {
      set({ selectedFileContent: "（无法读取文件）" });
    }
  },

  saveSkillContent: async (id, content) => {
    await api.writeSkillFile(id, content);
    set({ skillContent: content, editingSkill: false });
    toast().show("SKILL.md 已保存");
  },

  setEditingSkill: (v) => set({ editingSkill: v }),

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
        report.verdict === "pass" ? "安全审查通过" : report.verdict === "warn" ? "安全审查有警告" : "安全审查发现阻断问题",
        report.verdict === "pass" ? "success" : "error",
      );
      refreshActivity();
    } catch (error) {
      set({ auditingSkill: false });
      console.error(error);
      toast().show("安全审查失败", "error");
    }
  },
}));
