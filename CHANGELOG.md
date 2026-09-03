# Changelog

本文件记录 SkillDeck 的用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
