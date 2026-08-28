# CLAUDE.md

> Agent 入口文件：先读这里，再按任务读取引用文档。最后更新：2026-08-29。

## 事实优先级

1. 当前代码、测试和配置是行为事实。
2. [README.md](./README.md) 是当前产品说明和用户命令入口。
3. 本文件和 `docs/` 下的项目文档是协作与维护约定。
4. `docs/PRD-*.md`、`docs/SCOPE-personal.md`、`docs/APP-STRUCTURE.md` 是历史产品思考，不能直接当作当前实现规格；与代码或 README 冲突时，以后者为准。

## 项目速览

SkillDeck 是一个本地桌面端 AI 能力管理器，用于管理 Skills、Prompts、Rules、MCP、Plugins、Hooks、工具集和项目配置，并把 Skill 按需连接到 Claude、Codex、Trae、WorkBuddy 等 Agent。

- 桌面壳：Tauri 2，当前标识为 `com.tingke.skilldeck`
- 前端：React 18、TypeScript strict mode、Vite、Tailwind CSS、Zustand
- 后端：Rust Tauri commands、rusqlite SQLite、本地文件系统操作
- 数据：本机 SQLite 与 JSONL 活动日志；无云端服务或账号体系

## 按需读取

| 上下文 | 文件 |
| --- | --- |
| 项目定位、当前功能边界、架构地图、数据位置 | [docs/project.md](./docs/project.md) |
| 版本、依赖、命令、CI/CD、部署发布 | [docs/tech-stack.md](./docs/tech-stack.md) |
| TypeScript/React、Rust、数据库、文件系统、样式约定 | [docs/code-style.md](./docs/code-style.md) |
| 当前测试结构、新增测试方式、验证矩阵 | [docs/testing.md](./docs/testing.md) |
| 协作流程、确认边界、Git 和发布流程 | [docs/workflow.md](./docs/workflow.md) |

## 常用命令

```bash
npm ci
npm test                 # 前端/纯 TypeScript 单元测试
npm run test:layout      # 布局与 Tauri 窗口契约检查
npm run typecheck        # tsc --noEmit
npm run build            # TypeScript 检查 + Vite 构建
npm run tauri:dev        # 启动桌面开发模式

cd src-tauri
cargo check --locked
cargo test --locked
```

CI 会执行前端 build/test/layout 检查和 Rust check/test；本地改动至少运行与改动面匹配的检查。

## 硬性约束

- 使用 npm 和 `package-lock.json`；Rust 依赖使用 `Cargo.lock`，不临时切换包管理器。
- 不新增云端依赖、账号体系或常驻外部服务。
- 修改 Tauri command 时必须同步 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册和 `src/lib/tauri.ts` 包装。
- 修改 SQLite schema 或迁移时必须考虑既有用户数据库，并为迁移行为添加 Rust 测试。
- 删除、覆盖、移动真实文件或修改 Agent 配置前必须保留现有确认、冲突识别和自有配置标记逻辑。
- 当前没有 ESLint、Prettier、Clippy 配置和覆盖率阈值；不要在文档或汇报里声称这些检查存在。

## 完成标准

- 相关 `npm` 与 `cargo` 检查通过。
- 行为变化有最小回归测试或明确的布局契约更新。
- 用户可见行为、命令、数据位置或发布流程变化同步 README。
- Agent 协作约定或架构事实变化同步对应 `docs/` 文件。
- 检查 diff，不带入本地数据、密钥、生成产物或无关格式化。
