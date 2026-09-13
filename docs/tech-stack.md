# 技术栈与工具（Tech Stack & Tools）

> 最后更新：2026-08-29。版本以 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `Cargo.lock` 为准。

## 运行环境要求

- Node.js 20+
- npm 10+
- Rust stable
- Tauri 2 所需平台依赖
- macOS 和 Windows 是当前发布目标；Linux 数据路径已按 XDG 处理，但不是当前 Release 构建目标

## 前端

| 类别 | 选择 | 说明 |
| --- | --- | --- |
| UI 框架 | React 18 | 页面级组件在 `src/views/`，可复用组件在 `src/components/` |
| 语言 | TypeScript 5.5，strict mode | 目标 ES2021；`npm run typecheck` 主要检查 `src/` |
| 构建 | Vite 5 | 固定开发端口 5173，构建目标 ES2021 |
| 样式 | Tailwind CSS 3.4 + 全局设计 token | token 和组件类主要在 `src/styles.css` 与 `tailwind.config.js` |
| 状态 | Zustand 4 | 按领域拆分在 `src/stores/`：ui、skills、assets、extensions、workspace、packages、activity、toast |
| 图标 | lucide-react、simple-icons | 不引入组件库 |
| 桌面 API | `@tauri-apps/api` 2 | invoke 统一包装在 `src/lib/tauri.ts` |

没有 Redux、React Router、shadcn/ui、Vitest、ESLint 或 Prettier。不要按模板项目假设这些工具存在。

## 桌面后端

| 类别 | 选择 | 说明 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 窗口、菜单、capabilities 和打包配置在 `src-tauri/` |
| 语言 | Rust 2021 edition | 域逻辑按模块拆在 `src-tauri/src/` |
| 数据库 | rusqlite 0.32，bundled SQLite | 连接由 `DbState(Mutex<Connection>)` 管理 |
| 序列化 | serde / serde_json | preserve_order 用于稳定 JSON 配置处理 |
| TOML | toml 0.8 + indexmap 2 | 用于 Codex `config.toml` |
| 文件选择 | rfd 0.15 | 系统 folder/file picker |
| 打包 | zip 2，deflate only | `.ai-package.zip` 导入导出 |
| 其他 | dirs 5、sha2 0.10、uuid v4 | 数据目录、内容哈希、ID 生成 |

## 项目脚本

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按 lockfile 安装依赖 |
| `npm run dev` | 启动 Vite 前端开发服务 |
| `npm run tauri:dev` | 启动 Tauri 桌面开发模式 |
| `npm test` | esbuild 打包测试后由 Node test runner 执行 |
| `npm run test:layout` | 检查布局源码契约和 Tauri 窗口契约 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | TypeScript 检查并构建前端 |
| `npm run release:prepare -- X.Y.Z` | 同步全部发布版本字段，并把 changelog `Unreleased` 转成正式版本小节 |
| `npm run release:verify -- X.Y.Z` | 校验版本字段、changelog 日期小节和内容 |
| `npm run tauri:build` | 构建桌面安装包 |
| `npm run clean` | 删除 Vite/Cargo 增量产物；执行前确认没有未保存产物依赖 |
| `cd src-tauri && cargo check --locked` | Rust 类型与依赖检查 |
| `cd src-tauri && cargo test --locked` | Rust 单元测试 |

## 测试与质量工具

- 前端测试：`node:test` + `node:assert/strict`，由 `scripts/run-unit-tests.mjs` 自动发现 `tests/*.test.ts`。
- 布局契约：`scripts/verify-layout.mjs` 做源代码与配置断言，不是浏览器 E2E。
- Rust 测试：模块内 `#[cfg(test)]`，当前覆盖迁移、扫描、连接冲突、收纳、观察 Hook、项目工具集、扩展配置写入、工具集导入导出与备份恢复。
- CI：`.github/workflows/ci.yml`。
- 当前没有覆盖率阈值、pre-commit hook、格式化检查和 lint 配置。

## 构建与发布

- CI 在 push 到 `main` 和 pull request 时运行前端 build/test/layout 与 Rust check/test。
- Release 由 `.github/workflows/release.yml` 的 `v*` tag 或手动 workflow dispatch 触发。
- 构建产物：
  - macOS universal DMG
  - Windows x64 NSIS `.exe` / MSI `.msi`
- `CHANGELOG.md` 人工维护用户可见变化；`npm run release:prepare` 负责机械的版本同步和小节转换。
- Release workflow 会校验 tag 对应版本，并使用该版本 changelog 小节作为 Release Notes；先挂 draft，产物上传后发布。
- 应用内更新检查请求 `https://api.github.com/repos/tingke/skill-deck/releases/latest`，仅比较版本并返回链接，不做自动下载或安装。

## 本地数据与外部边界

- 数据库和 JSONL 日志保存在 `dirs::data_dir()/skilldeck`。
- WebView 启用 CSP；开发模式单独放宽 inline script 与 Vite HMR 端口。release 构建默认不启用 devtools，需要时用 cargo feature `devtools` 显式开启。
- Skill 文件留在库源原位，Agent 入口用 symlink 接线。
- 文件选择、备份恢复、连接和配置修改都发生在用户本机。
- 除设置页更新检查访问 GitHub Releases 外，应用不依赖云端服务。
