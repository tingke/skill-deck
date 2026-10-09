# SkillDeck

SkillDeck 是一个本地 AI Skill 管理器，用来集中管理 Skills、Prompts、Rules、MCP、Plugins、Hooks 和工具集，并按需接入 Claude、Codex、Trae、WorkBuddy 等 Agent。

它的核心目标不是把所有能力一直挂载到每个 Agent，而是维护一个可筛选、可编辑、可接线的本地能力库：需要哪些能力，就接入哪些能力；场景变了，就切换对应组合。

## 预览

![01-do](screenshots/01-do.png)

![02-skill](screenshots/02-skill.png)

![03-plugin](screenshots/03-plugin.png)

![04-package](screenshots/04-package.png)

## 功能

- **Skill 库源管理**：登记多个本地库源，扫描 `SKILL.md`，查看描述、标签、权限和内容。库源是 Skill 的唯一归属地和安装目标；目录须为纯 Skill 集合，与项目、Agent skills 目录或其他库源重叠时拒绝保存。删除库源只移除登记，磁盘文件保留，已连接的软链会残留。
- **Skill 安装与更新**：从 Git 仓库、Zip 压缩包或本地目录安装 Skill 到指定库源；记录安装来源与版本，支持检查更新、本地改动检测和事务性替换回滚。
- **安全体检**（原「审计」）：为技能做安全检查，结论用白话分级（安全 / 需留意 / 危险）并给出处理建议（断开连接、删除）；体检报告含总分、四类状态统计和按风险排序的技能列表；安装与更新前自动执行同一套静态检查（凭据读取、破坏性命令、提示注入、可执行二进制、symlink 逃逸等），危险项默认拦截，警告项需勾选确认后才能继续。
- **在线商店**：手动同步官方 MCP Registry，或配置团队自定义 HTTPS 目录；技能与工具（MCP）安装走小白友好的向导（概念解释、密钥填写引导、配置收进「高级」折叠），密钥只使用占位符并由用户显式填写。
- **Agent 接线**：为 Skill 创建或断开到各 Agent skills 目录的链接，支持单选和批量操作。
- **冲突识别**：区分软链接、真实目录和真实文件，避免误删或覆盖已有入口。
- **场景预设**：按场景维护 Skill 组合，一键切换当前 Agent 的能力挂载。
- **安全应用与导出**：应用预设前查看变更计划；项目应用支持 `.mcp.json` 与检测到的 Agent MCP 配置；导入会安装并审查打包 Skill；导出默认脱敏 MCP 凭证字段。
- **安全应用与导出**：应用预设前查看变更计划；导入会安装并审查打包 Skill；导出默认脱敏 MCP 凭证字段。
- **能力资产管理**：管理 Prompts、Rules、MCP、Plugins、Hooks 和项目工具集。
- **Agent 观察与任务进度**：一键为 Claude Code / Codex 安装观察 Hook，实时查看工具活动、当前任务、当前步骤和进度。
- **本地数据**：数据和 SQLite 数据库保存在本机；应用不内置云端服务，市场目录只在点击同步时访问用户选择的 HTTPS 来源。

## 技术栈

- 桌面壳：Tauri 2
- 前端：React、TypeScript、Vite、Tailwind CSS、Zustand
- 后端逻辑：Rust、rusqlite

## 开发

要求：

- Node.js 20+
- npm 10+
- Rust stable
- Tauri 2 的平台依赖

常用命令：

```bash
npm ci
npm run dev          # 启动前端开发服务
npm run tauri:dev    # 启动桌面应用开发模式
npm test             # 运行前端单元测试
npm run test:layout  # 运行布局与 Tauri 窗口契约检查
npm run build        # TypeScript 检查并构建前端
npm run tauri:build  # 构建桌面安装包
```

Rust 侧检查：

```bash
cd src-tauri
cargo check --locked
cargo test --locked
```

## 数据位置

macOS 数据目录：

```text
~/Library/Application Support/skilldeck
```

主要文件：

- `skilldeck.db`：SQLite 数据库
- `agent-events.jsonl`：Agent 观察 Hook 的事件日志（最多在界面中展示最近 500 条）
- `~/.skill-deck`：全新安装的默认主库源，会递归扫描库源下的 Skills

## Agent 观察与任务进度

1. 进入「Hooks」页面，在「Agent 观察」中为 Claude Code 或 Codex 打开开关。
2. 重启对应 Agent；Hook 会把会话、工具调用、当前项目与任务进度写入本地事件日志。
3. 回到「概览」页面查看实时 Agent 活动与任务进度；任务进度、步骤或 Agent 状态变化会以客户端右下角 Toast 通知提醒。

观察 Hook 是 fail-open 的纯观察者：Claude 写入 `~/.claude/settings.json`，Codex 写入 `~/.codex/hooks.json` 并启用 `features.hooks`；移除时只删除带 SkillDeck 标记的自有 Hook，不影响其他配置。

任务进度不绑定特定工作流。Hook 事件可以直接携带嵌套 `task` 对象，也可以使用同名字段：

```json
{
  "session_id": "agent-session",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUse",
  "task": {
    "id": "login-feature",
    "title": "登录功能",
    "status": "in_progress",
    "progress": 65,
    "step": "修复登录回调"
  },
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" }
}
```

`progress` 支持 `0-1` 比例或 `0-100` 百分比。未上报进度时仍会显示任务、状态、步骤和最近活动，进度显示为 `--`。

已有 `ai-hub` 数据库会在首次启动 SkillDeck 时复制到新的数据目录，原文件保留不删。

## 商店与在线目录

1. 进入「商店」，默认来源是官方目录（MCP Registry）：`https://registry.modelcontextprotocol.io/v0.1/servers`。更新目录只读取 HTTPS JSON，不会上传本地数据或凭证。
2. 切换到「团队目录」后，可以配置自己的 HTTPS JSON 清单，例如：

   ```json
   {
     "version": 1,
     "name": "Team Marketplace",
     "skills": [
       {
         "id": "team/design",
         "name": "design",
         "description": "Interface review guidelines",
         "author": "team",
         "tags": ["design"],
         "homepage": "https://example.com/design",
         "source": {
           "kind": "git",
           "source_ref": "https://github.com/example/skills",
           "subdir": "skills/design"
         }
       }
     ],
     "mcps": [
       {
         "id": "team/github",
         "name": "GitHub",
         "server_name": "github",
         "description": "GitHub MCP",
         "config": {
           "command": "npx",
           "args": ["-y", "@modelcontextprotocol/server-github"],
           "env": { "GITHUB_TOKEN": "{{config.GITHUB_TOKEN}}" }
         },
         "required_inputs": [
           { "name": "GITHUB_TOKEN", "description": "GitHub token", "is_secret": true }
         ]
       }
     ]
   }
   ```

3. 技能安装会先进入暂存目录并自动做安全检查；检查通过直接安装并引导「去启用」，发现风险需勾选「我已了解风险」才能继续，危险项默认不允许安装，同名冲突不会被静默跳过。
4. 工具（MCP）安装是两步向导：先选装给哪个 AI，再填连接密钥（附获取指引，只存本机）；将写入的 JSON 收进「高级」折叠，需要密钥的条目只有用户填写后才会写入配置，同名工具必须勾选确认后才覆盖。
5. 官方目录中无法自动、安全转换为当前 Agent 配置格式的条目会标记为「进阶 · 需手动设置」，只提供文档入口，不会自动写入猜测配置。

## 发布

Release 由 GitHub Actions 自动构建：

1. 在 [`CHANGELOG.md`](./CHANGELOG.md) 的 `Unreleased` 小节填写本次用户可见变化。
2. 运行 `npm run release:prepare -- 0.0.3`，同步前端、Tauri 和 Cargo 版本，并把 changelog 转成带日期的正式版本小节。
3. 检查 diff 并运行发布前检查，然后运行 `npm run release:verify -- 0.0.3`。
4. 提交并推送代码到 `main`。
5. 创建版本标签并推送，例如 `v0.0.3`。
6. `v*` 标签触发 `.github/workflows/release.yml`。
7. Actions 校验 tag 对应的版本和 changelog，使用该版本 changelog 作为 Release Notes，构建 macOS universal DMG 和 Windows x64 安装包并发布到 GitHub Releases。

```bash
git tag v0.0.3
git push origin v0.0.3
```

## 项目结构

```text
src/               React 界面与前端状态
src-tauri/         Rust 命令、扫描器、数据库与桌面壳
scripts/           本地测试脚本
tests/             前端单元测试
```

## 仓库

GitHub：<https://github.com/tingke/skill-deck>
