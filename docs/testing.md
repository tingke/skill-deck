# 测试规范（Testing）

> 最后更新：2026-10-09。当前测试体系是轻量的：Node test runner + Rust module tests + 源码契约检查，没有覆盖率阈值。

## 当前检查

| 命令 | 覆盖内容 | 当前基线 |
| --- | --- | --- |
| `npm test` | 纯 TypeScript 逻辑与 Zustand 确认流 | 31 个 Node test |
| `npm run test:layout` | App shell、Skills 布局、Tauri 窗口、drag region、设计 token 契约 | 通过 |
| `npm run typecheck` | TypeScript strict 检查 | 通过 |
| `npm run build` | typecheck + Vite production build | CI 前端必跑 |
| `cd src-tauri && cargo check --locked` | Rust 编译与依赖检查 | CI 必跑 |
| `cd src-tauri && cargo test --locked` | Rust 域逻辑和迁移 | 当前 88 个测试通过、2 个网络测试默认忽略 |

## 前端单元测试

测试文件在 `tests/*.test.ts`，使用：

```typescript
import assert from "node:assert/strict";
import test from "node:test";
```

`scripts/run-unit-tests.mjs` 自动发现 `tests/*.test.ts`，用 esbuild bundle 到临时目录，再调用 `node --test`。新增测试文件无需修改脚本；文件名必须以 `.test.ts` 结尾。

### 适合前端测试的逻辑

- 路径格式化和展示规则
- 扫描编排中的部分失败策略
- 错误 payload 解析和确认对象构造
- 批量选择过滤
- 删除/断开确认状态机
- Agent 活动 snapshot 的通知去重与进度换算

测试尽量传入普通对象和函数依赖，不 mock Tauri 全局对象。需要直接调用 store 时，先按现有测试方式提供 `localStorage` stub。

## 布局契约测试

`scripts/verify-layout.mjs` 读取源码和配置并断言：

- Tauri 主窗口使用 overlay title bar、hidden title 和 traffic light position。
- capability 允许 main window start dragging。
- App shell 保留主侧栏、workspace toolbar 和 drag region。
- Skills 左栏、共享 DetailDrawer、token 化网格和窄容器行为不回退。
- 不重新引入任意 11–13px 字号（最小类型档 `--text-2xs` 为 13px）。

修改 `App.tsx`、`SkillsView.tsx`、`DetailDrawer.tsx`、`styles.css`、`tailwind.config.js` 或 Tauri 窗口配置后运行它。若布局行为有意变化，同步更新契约断言，而不是删除检查。

## Rust 测试

- 测试放在对应模块的 `#[cfg(test)] mod tests`。
- 必须覆盖：
  - schema 迁移和旧数据兼容
  - frontmatter/SKILL 扫描边界
  - skill 安全审查规则（凭据读取、提示注入、可执行二进制、symlink 逃逸）与安装/更新门禁
  - 审计规则目录完整性、得分模型与批量审计摘要
  - 安装来源 fetch、暂存落盘、zip 路径穿越拒绝、冲突不覆盖与更新回滚
  - symlink、真实目录、真实文件和共享链接冲突
  - 收纳真实入口时的失败回退
  - MCP/Hook/Plugin 配置写入：只改目标条目、保留未知字段、幂等启用与空事件清理
- 工具集导出/导入 round-trip、manifest 解析边界与应用到项目的落地行为
- Agent MCP 配置目标、Package 应用计划、路径穿越拒绝、覆盖确认、导出脱敏和自包含导入
  - 数据库备份复制、恢复替换旧数据、旧备份缺表时跳过
  - 用户配置合并、幂等和只删除自有 marker
  - 项目工具集提取与更新
- 使用临时数据库/目录，不读写真实 `~`、应用数据目录或用户 Agent 配置。
- 断言错误路径和路径未变化的情况，不只测试 happy path。

市场同步包含两个显式 `#[ignore = "network"]` 的在线 smoke test。常规 CI 不访问外网；需要验证真实在线链路时运行：

```bash
cd src-tauri
cargo test --locked official_registry_live_sync_smoke -- --ignored
cargo test --locked installs_public_marketplace_skill_from_git_subdirectory -- --ignored
```

## UI 手动验证

桌面 UI 没有自动 E2E。涉及用户可见流程时，在环境允许时运行：

```bash
npm run tauri:dev
```

重点确认：

1. 页面能打开，主导航和主题切换可用。
2. 涉及的列表、筛选、详情抽屉和对话框可见。
3. 失败路径能显示 Toast，不重复提交。
4. macOS overlay 标题栏拖拽区域可用。
5. 会修改文件/配置的操作先展示目标、冲突或影响面。

开发模式会访问本机真实数据目录；不要为了测试随手删除真实库源或 Agent 配置。

## 选择最小验证集

- 仅文档：检查引用路径和命令是否真实存在。
- TypeScript 纯逻辑：`npm test` + `npm run typecheck`。
- React 视图/布局：`npm run test:layout` + `npm run build`，必要时手动打开页面。
- Tauri command/Rust 域逻辑：`cargo test --locked` + 相关前端调用检查。
- schema/迁移：`cargo test --locked`，并考虑备份恢复路径。
- 共享行为或发布配置：运行与 CI 相同的前端和 Rust 检查。
