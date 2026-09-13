# Changelog

本文件记录 SkillDeck 的用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 项目页新增预设漂移状态，可识别缺少预设、目录不可用、待同步数量和已同步状态。
- 当前项目识别：根据本地 Agent 活动的 working/waiting 项目路径，在项目列表中标记当前项目。
- 项目预设一键同步现在会先刷新项目扫描，再更新对应 Package 并刷新漂移状态。

## [0.0.3] - 2026-09-13

### Added

- 项目级 Package 应用前生成变更计划，展示 Skill、项目 MCP 和规则文件的当前差异；应用时不再跳过项目 MCP。
- 项目 MCP 写入可用的项目检测目标，包括可移植 `.mcp.json` 和已检测 Agent 的 JSON/TOML 配置，同时保留未知配置字段。
- 应用内自动更新：通过官方 Updater 插件检查、下载并安装新版本（含签名校验），支持 macOS、Windows、Linux；发布流水线新增更新签名产物与 latest.json 清单。
- 为 MCP、Hook 和 Plugin 的配置写入路径补充回归测试，覆盖只改目标条目、保留未知字段、幂等启用和空事件清理。
- 新增 Agent MCP 配置统一解析：Package 应用和 MCP 管理读写同一配置目标，避免 Claude MCP 写入位置漂移，并支持注册表中的自定义 Agent。
- 新增 Package 应用计划：应用前展示 Skill 软链、MCP 和规则文件的新增、写入、覆盖、冲突与缺失；存在冲突时阻止应用。
- Package 导入现在会安装压缩包内未安装的 Skill，先进入暂存目录完成安全审查，再关联到导入后的工具集。
- Package 导出默认脱敏 MCP `env` 中的敏感字段，并返回脱敏字段列表；包含真实凭证需要显式选择。

### Removed

- 移除旧的 ai-hub 遗留迁移逻辑（旧数据库复制、历史目录搬移与标签恢复）。

### Changed

- 扫描、安装/更新、包导入导出、备份恢复和活动读取等重 I/O 操作改为后台线程执行，大库源操作不再阻塞界面。
- Agent 活动日志超过 5MB 时自动轮转（保留最近 5000 条），轮询改为尾部窗口读取，避免日志无限增长和每次全量解析。
- WebView 启用 CSP；release 构建默认不再包含开发者工具，可用 cargo feature `devtools` 显式开启。

### Fixed

- 前端测试脚本自动发现 `tests/*.test.ts`，新增测试文件不会再被静默跳过。
- 修复用户主目录不可用时部分命令可能 panic 的问题。
- 修复 AI Package YAML manifest 解析时跳过首个组件的问题。
- 项目级 Package 应用拒绝路径穿越、软链配置目标，并要求显式确认后才覆盖已变化的项目配置。

## [0.0.2] - 2026-09-03

### Added

- 支持从 Git 仓库、Zip 压缩包和本地目录安装 Skill；记录安装来源与版本，支持检查更新、本地改动检测和事务性替换回滚。
- 安装和更新 Skill 前执行静态安全审查，覆盖凭据读取、破坏性命令、提示注入、可执行二进制和 symlink 逃逸等风险；阻断级问题默认拦截，可显式确认放行。
- 递归扫描 Skill 库源时保留嵌套 Skills 的标签信息。
- 支持安装 Claude Code / Codex 观察 Hook，在概览页查看实时工具活动、当前任务、步骤和进度，并在状态变化时发送通知。
- 完善活动与能力资产管理界面。

## [0.0.1] - 2026-08-18

### Added

- SkillDeck 初始发布。
- 支持本地 Skill 库源管理、递归扫描 `SKILL.md`、查看描述、标签、权限和内容。
- 支持把 Skill 连接到 Claude、Codex、Trae、WorkBuddy 等 Agent 的 skills 目录，并可单选或批量断开。
- 识别软链接、真实目录和真实文件，避免误删或覆盖已有入口。
- 支持按场景维护 Skill 组合，一键切换当前 Agent 的能力挂载。
- 支持管理 Prompts、Rules、MCP、Plugins、Hooks 和项目工具集。
- 数据和 SQLite 数据库保存在本机，不依赖云端服务。
