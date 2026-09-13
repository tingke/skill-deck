# 代码风格（Code Style）

> 最后更新：2026-08-29。仓库没有强制 formatter/linter；新改动应匹配相邻代码，而不是大规模重排既有文件。

## 通用规则

- TypeScript/JavaScript 使用双引号、分号和 2 空格缩进；Rust 使用标准 Rust 格式化习惯。
- 只做任务相关改动。发现无关问题可以记录，不顺手重写。
- 不为了个人偏好重命名稳定字段；数据库行和 Tauri payload 中已有大量 snake_case 字段。
- 新增依赖必须有明确理由，并同步 lockfile；默认复用现有依赖和标准库。
- 用户可见错误不能静默丢失；后台加载失败可以在现有 store 模式下降级为空状态，但写操作要 Toast 报错并保留 console 诊断。

## TypeScript / React

### 文件组织

- `src/types.ts`：跨视图、store、Tauri 包装的共享类型。
- `src/lib/`：可单测的纯函数和所有 Tauri invoke 包装。
- `src/stores/`：Zustand state、异步动作和确认流状态。
- `src/views/`：页面级组件；避免多个页面复制同一业务逻辑。
- `src/components/`：跨页面复用 UI。
- `src/i18n/zh.ts` 与 `src/i18n/en.ts`：新增用户可见文案时同步两份。

### 命名

- 组件和类型用 PascalCase。
- 变量、函数、hook 用 camelCase。
- 常量用 UPPER_SNAKE_CASE。
- 数据库映射类型保留原始 snake_case 字段，例如 `source_lib`、`target_path`；不要在前端局部“美化”导致序列化不一致。
- 测试文件放在 `tests/`，命名为 `*.test.ts`。

### 实现约定

- 视图组件不直接散落 `invoke("...")`；新增 API 先在 `src/lib/tauri.ts` 建类型化包装。
- 可纯化的业务规则（路径显示、扫描编排、确认 payload、通知 diff、批量选择）放 `src/lib/` 并加 Node 测试。
- 跨页面状态按领域拆在 `src/stores/`：`ui.ts`（视图/搜索/主题）、`skills.ts`（Skill 列表、连接、详情与确认流）、`assets.ts`（Prompts/Rules）、`extensions.ts`、`workspace.ts`（Agents/Projects/LibrarySources）、`packages.ts`、`activity.ts`。新增状态先判断归属领域，不要回流成单一 god store；组件内部 UI 状态用 `useState`。
- 危险操作使用显式 pending confirmation 对象和确认对话框，不使用 `confirm()` 或字符串状态模拟。
- 异步操作要防止重复提交；确认执行中用 `connectionConfirming`、`skillDeleting` 这类 in-flight 标志。
- 保留布局契约依赖的 `data-testid` 和 `data-tauri-drag-region`。
- 避免新增任意 9/10/11px 字号；优先使用 `text-2xs`、`text-xs` 等类型 token。

### 样式

- 主题色、间距、字号、圆角、阴影和 z-index 使用 `src/styles.css` 的 CSS variables / Tailwind semantic tokens。
- 复杂布局优先沉淀为 `styles.css` 中的组件类，并用 token 控制宽度与高度。
- 深色模式通过 class 切换；不要写死只适配浅色的颜色。

## Rust / Tauri

### 模块与命令

- 按领域拆模块：扫描、连接、扩展、包、项目、Agent、设置、活动观察。
- `#[tauri::command]` 必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册，否则前端 invoke 会失败。
- command 参数与前端包装保持一致；需要复用的域逻辑抽成普通函数，便于测试。
- SQLite 访问通过 `State<DbState>` 获取连接，并在持锁期间完成事务性操作。
- 错误当前以 `Result<T, String>` 返回给 Tauri；错误文案应可理解并可诊断，不吞错。

### 文件系统安全

- 展示路径可以转成 `~`，但执行操作必须保留绝对路径或明确展开 home。
- 连接前探测入口类型；真实目录和真实文件不得被 symlink 创建覆盖。
- 删除或移动前检查目标、冲突和影响面；共享 symlink 必须走确认路径。
- 修改用户配置时保留未知字段，优先原子写入，只处理 SkillDeck 拥有或用户明确选择的条目。

### 数据库

- schema 建表和迁移集中在 `src-tauri/src/db.rs`。
- 迁移必须兼容旧数据库，不能假设本地可以删库重建。
- 新列先用 `PRAGMA table_info` 判断，再 `ALTER TABLE`。
- 破坏性或复杂迁移必须加 `#[cfg(test)]` 测试，并使用临时数据库/目录。
- 启用外键约束，删除顺序要考虑引用关系。

## 注释

- 注释解释非显而易见的安全边界、迁移原因、平台差异和业务规则。
- 自解释代码不加复述式注释。
- TODO 必须说明阻塞条件或后续条件，不留下无上下文的标记。
