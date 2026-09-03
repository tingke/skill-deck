# 工作流规则（Workflow Rules）

> 最后更新：2026-08-29。

## 任务流程

1. 读 `CLAUDE.md`、README 中与任务相关的部分，以及会被修改的代码/测试。
2. 先查找已有类型、helper、组件、command、测试和脚本；复用现有结构。
3. 小步实现，避免猜测性抽象和大范围重写。
4. 运行与改动面匹配的检查；失败先修复或明确说明阻塞。
5. 清理本任务产生的临时文件、无用 import 和生成产物。
6. 汇报改动、验证、未验证项、重要文件和剩余风险。

## 自主与确认边界

### 可自主完成

- 修正文档与当前实现不一致的地方
- 添加不改变行为的类型定义
- 为现有逻辑补测试
- 保持行为的局部重构
- 修复明确失败或拼写错误
- 更新构建/测试脚本中与新增文件直接相关的注册项

### 先确认

- 新增或升级生产依赖
- 修改 SQLite schema、迁移或备份恢复语义
- 修改删除、覆盖、移动文件或 Agent 配置的行为
- 改变 Tauri command/payload 兼容性
- 改变发布目标、GitHub Actions 权限或自动发布行为
- 涉及凭证、计费、外部服务或生产系统

### 禁止

- 未获明确批准 push 到 `main` 或默认分支
- force-push、重写历史或 reset 分支
- 绕过 hooks 或使用 `--no-verify`
- 把密钥、本地绝对路径和数据库备份放进提交
- 为了测试或清理直接删除用户 `~/.skill-deck`、应用数据目录或 Agent 配置

## Git 约定

- 使用功能分支；Codex 创建分支默认使用 `codex/` 前缀。
- 分支命名可用 `feature/`、`fix/`、`docs/`、`chore/` 或 `codex/<task>`。
- 提交信息遵循 Conventional Commits，例如 `fix(skills): confirm shared symlink disconnect`。
- 提交前检查 `git diff` 和 staged 文件，避免无关格式化、构建产物、本地数据或密钥。
- `dist/`、`src-tauri/target/`、日志和 `.DS_Store` 不提交。

## 发布流程

1. 确认 CI 通过。
2. 在 `CHANGELOG.md` 的 `Unreleased` 小节填写用户可见变化。
3. 运行 `npm run release:prepare -- X.Y.Z` 同步 `package.json`、`package-lock.json`、Tauri 配置、Cargo manifest/lock，并把 `Unreleased` 转成带日期的正式版本小节。
4. 检查 diff、运行发布前检查和 `npm run release:verify -- X.Y.Z`。
5. 经确认后合入 `main`。
6. 创建并推送 `vX.Y.Z` tag。
7. `v*` tag 触发 `.github/workflows/release.yml`。
8. Actions 校验 tag 对应版本和 changelog，构建 macOS universal DMG 和 Windows x64 安装包，创建使用 changelog 内容的 draft Release、上传产物后发布。

不要手工重签或修改已发布产物；发布失败时先读 Actions 日志，再决定重跑 job 或重新打 tag。

## 沟通约定

- 不确定时先给出已验证事实、假设和可选方案，再继续低风险路径。
- 汇报错误时包含重现步骤、预期、实际和相关日志。
- 不编造包版本、API 行为、平台差异或命令结果；未验证就明确说未验证。
- 对用户可见或行为变化，说明可观察结果。

## 文档更新

| 变化 | 更新位置 |
| --- | --- |
| 功能、安装、数据位置、发布流程 | `README.md` |
| 项目定位、架构、数据边界 | `docs/project.md` |
| 依赖、脚本、CI/发布 | `docs/tech-stack.md` |
| 协作/架构约定 | `docs/code-style.md`、`docs/workflow.md` |
| 测试策略或新增检查 | `docs/testing.md` |
| 历史 PRD 结论 | 只追加新决策文档或 README，不回改旧 PRD 伪装成当时结论 |
