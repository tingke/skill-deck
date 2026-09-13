# 项目身份（Project Identity）

> 最后更新：2026-09-03。

## 名称与定位

- 产品名：**SkillDeck**
- 包名：`skill-deck` / Rust crate `skill-deck`
- 版本：`0.0.2`
- 一句话定位：本地 AI Skill 与能力资产管理器，把分散在本机的 Skills、Prompts、Rules、MCP、Plugins、Hooks 和工具集整理成可筛选、可编辑、可接线的本地能力库。

目标用户是本机同时使用多个 AI Agent 的开发者和重度用户。SkillDeck 的价值不是把所有能力永久挂载给每个 Agent，而是让当前场景只需要的能力在场，避免提示词膨胀和 Skill 触发冲突。

## 当前阶段

- [x] MVP 已可运行
- [x] 功能迭代中
- [ ] 性能优化专项
- [ ] 多人/组织治理

当前迭代重点是 Skill 连接安全、工具集/预设、项目能力提取，以及 Claude Code / Codex 的本地活动观察。

## 当前功能边界

### 已实现的核心能力

- **Skill 库源与扫描**：登记多个本地库源；递归扫描 `SKILL.md`，读取描述、标签、作者、版本、许可、权限和内容哈希；默认主库源为 `~/.skill-deck`。
- **Skill 安装与更新**：从 Git 仓库、Zip 包或本地目录安装到指定库源；记录来源、版本和目录哈希，支持更新检查、本地改动检测和事务性替换回滚。
- **Skill 安全审查**：安装与更新前执行静态审查；识别凭据读取、破坏性命令、提示注入、可执行二进制和 symlink 逃逸等风险，阻断级问题默认拦截并允许显式确认。
- **Skill 接线**：以 symlink 连接或断开 Skill 与 Agent skills 目录；支持批量操作、启用/禁用 manifest、共享链接识别和显式确认。
- **冲突安全**：区分 symlink、真实目录和真实文件；拒绝直接覆盖真实入口，支持把真实入口收纳进库源并保留连接。
- **能力资产**：管理 Prompts、Rules、MCP、Hooks、Plugins 和 Agent 注册表。
- **工具集/预设**：组合 Skills、MCP 与配置文件；应用 Agent 前生成变更计划，冲突和缺失默认阻断；导入导出 `.ai-package.zip`，导入会安装并审查打包 Skill；导出默认脱敏 MCP 凭证。项目应用同样先生成变更计划，支持项目级 `.mcp.json` 和已检测 Agent 的 JSON/TOML MCP 配置；路径穿越、软链和覆盖仍有保护。
- **项目管理**：登记项目根目录，扫描项目 Skill 与项目配置，生成项目工具集。
- **Agent 观察**：为 Claude Code / Codex 安装带 `skilldeck-agent-observer` 标记的观察 Hook，读取最近 500 条本地事件并展示任务、步骤和进度。
- **本地设置**：主题、语言偏好、Agent 路径、开机启动、数据库备份恢复和数据目录打开。

### 明确不做

- 云同步、账号体系、团队权限和企业治理
- 运行期权限沙箱或跨厂商权限强制
- AI 能力市场与商业分发标准
- 无边界扫描整个 home 目录或整台电脑
- 把 Skill 从原库复制成多份维护

历史 PRD 中关于运行期权限强制、安装市场和跨机智能迁移的内容已被后续决策收缩；不要按旧 PRD 恢复这些承诺。

## 架构地图

### 前端

```text
src/
├── App.tsx                    # 应用壳、主导航、窗口拖拽、主题和视图挂载
├── components/                # 可复用对话框、Toast、详情抽屉、Agent 图标等
├── i18n/                      # 中英文文案，zh.ts / en.ts 需同步
├── lib/                       # 纯逻辑与 Tauri invoke 包装
├── stores/                    # Zustand 状态与异步动作
├── views/                     # 每个一级页面的页面级组件
├── styles.css                 # 设计 token、布局组件和全局样式
└── types.ts                   # 前端共享类型
```

数据流是 `views/components -> src/stores/（按领域拆分的 Zustand store）-> lib/tauri.ts -> Tauri command -> Rust domain module -> SQLite/filesystem`。可测试的路径格式、扫描编排、确认 payload 和通知 diff 逻辑放在 `src/lib/`，避免只存在于视图组件中。

### Rust / Tauri

```text
src-tauri/src/
├── lib.rs                     # Tauri setup、菜单和 command 注册表
├── main.rs                    # 桌面入口；`hook` 子命令进入观察 Hook CLI
├── db.rs                      # SQLite 连接、schema、迁移、种子数据和行类型
├── scanner.rs                 # SKILL.md/frontmatter/库源扫描
├── skill_connections.rs       # symlink 探测、连接、断开、收纳和冲突保护
├── commands.rs                # Skills、库源、Prompts、Rules 等主命令
├── extensions.rs              # MCP/Hook/Plugin 扫描与配置写入
├── packages.rs                # 工具集保存、应用、导入导出
├── project_packages.rs        # 从项目内容提取工具集
├── projects.rs                # 项目登记与项目 Skill 扫描
├── agents.rs                  # Agent 注册表命令
├── settings.rs                # 启动项、备份恢复、更新检查
└── agent_activity.rs          # 观察 Hook、JSONL 日志、活动快照
```

### 数据与重要文件

应用数据目录由 `dirs::data_dir()/skilldeck` 决定：

- macOS：`~/Library/Application Support/skilldeck`
- Windows：`%APPDATA%\skilldeck`
- Linux/XDG：`~/.local/share/skilldeck`

主要文件：

- `skilldeck.db`：SQLite 数据库，包含 skills、connections、library_sources、agents、prompts、rules、extensions、packages、projects、activity_log、settings 等表。
- `agent-events.jsonl`：Agent 观察 Hook 事件日志；界面快照最多读取最近 500 条。
- `~/.skill-deck`：默认主库源；Skill 原文件保留在库源中。
- Claude 观察 Hook：`~/.claude/settings.json`
- Codex 观察 Hook：`~/.codex/hooks.json`，并在 `~/.codex/config.toml` 启用 hooks feature

观察 Hook 只删除带自有 marker 的配置项，不删除用户其他 Hook。所有会修改用户 Agent 配置的功能都必须保持这个边界。

## 文档关系

- [README.md](../README.md)：当前产品说明、快速开始、数据位置和发布说明。
- [APP-STRUCTURE.md](./APP-STRUCTURE.md)：早期界面结构草稿，仅作历史参考。
- [PRD-v1.0.md](./PRD-v1.0.md)、[PRD-v1.0-revised.md](./PRD-v1.0-revised.md)：产品范围演化记录。
- [SCOPE-personal.md](./SCOPE-personal.md)：个人版早期范围判断。
- [ai-package-spec-v0.1.md](./ai-package-spec-v0.1.md)：工具集包格式相关规范，当前导入导出实现只消费其中一部分。
