# 代码风格（Code Style）

> 最后更新：2026-10-21。仓库没有强制 formatter/linter；新改动应匹配相邻代码，而不是大规模重排既有文件。

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
- 避免新增任意 11/12/13px 字号（最小档 `--text-2xs` 为 13px）；优先使用 `text-2xs`、`text-xs` 等类型 token。

### 样式

- 主题色、间距、字号、圆角、阴影和 z-index 使用 `src/styles.css` 的 CSS variables / Tailwind semantic tokens。
- 复杂布局优先沉淀为 `styles.css` 中的组件类，并用 token 控制宽度与高度。
- 深色模式通过 class 切换；不要写死只适配浅色的颜色。

### 统一 UI 组件与页面规范（2026-10-21 起）

新页面或改老页面时按下述约定走，不要再各页自建；完整背景见 `designs/页面统一盘点与方案.md`，实物速查在应用内「设计系统」页。

- 页面骨架（V6 悬浮玻璃工具栏）：每页一条圆角玻璃 pill `PageHeader`（高 `--height-page-bar` 40px，inset 10/12）——左＝标题（可省）+ 副题 + `toolbar` 槽（`SearchInput` 等），右＝至多一个 `.btn-primary` 主按钮；空白区即窗口拖拽区。集合页标题下放内容区，用 `ContentTitle`（h1 20/700 + meta 11px）；概览/安检等标题留在栏内。技能页用同款 `.skills-toolbar` pill（视图切换用 `.seg` 分段控件，标签/库源筛选用下拉 `optgroup`，不用左侧聚类栏）。
- 全局控制：折叠侧栏、全局扫描、主题切换固定在侧栏底部 footer，不在页面栏内重复；概览页可在栏内加扫描快捷钮。
- 搜索：可增长集合页（≥3 条）必须有；用 `SearchInput`（固定 `--width-search` 180px，含搜索图标）；筛选控件（下拉）并入同一栏，不放搜索右侧之外。
- 空态：用 `.empty-state` 四要素——图标 + 「没有X」标题 + 一句为什么空 + 主行动按钮（复用页头动作）；`EmptyState`（从 `MCPView` 导出）支持可选 `action`。
- 危险操作：列表行尾至多一个 `RowMenu`（⋯ 菜单），编辑/删除收进去；删除仍走 `useDeleteConfirmation` + `DeleteConfirmDialog`；红色只允许出现在菜单层、危险徽章和确认框内，行内不常驻红垃圾桶。
- 开关：`ToggleSwitch`（ExtList）与卡片图标开关选中态用 `bg-accent`/`text-accent`；不用绿色表达「启用」。
- 语义色锁定：绿=安全/已启用、黄=需留意、红=危险/错误、灰=未配置/零值、紫=强调/选中；零值计数一律 `text-faint`。
- 术语：页面标题、列名、徽章中文优先——Skill=技能、MCP=工具（MCP）、Hook=钩子、Agent=智能体；「接线」（Agent 连接）与「启用」是两套状态，不混用。
- 材质层：玻璃只用于 chrome（侧栏/聚类栏/悬浮页栏/抽屉/悬浮控件），用 `.glass-panel` / `.ambient-bg`；卡片与正文实底（暗色 surface=#232329、页面底=#131318，见 `--c-*` 暗色组）。token 见 `--mat-glass-*`、`--grad-ambient`、`--mat-content-tint`、`--c-accent-text`（暗色下图标/链接用提亮紫）。
- 控件规格：`.btn` 高 26/字 12/圆角 7（主按钮带内高光+紫色投影）、`.btn-icon` 26、`.input` 高 26/字 12；卡片网格用 `.card-grid`（`repeat(auto-fill, minmax(272px, 1fr))` gap 12），不要写死 `grid-cols-2`。
- 列表样式（V1 原型）：行集合装进 `.list-panel`（圆角 11 实底 + 发丝线边框），行用 `.list-row`（46px、发丝线分隔、hover surface、选中 accent-soft）；技能列表行是五列变体 `.list-row--skill`（名称/描述/智能体图标簇/体检徽章/箭头）；不要给单行自配边框或阴影。
- 详情抽屉（V1 Inspector）：`DetailDrawer` = 340px 玻璃面板（surface 94% + blur 30 + saturate 1.6）、无遮罩压暗、280ms cubic-bezier(.32,.72,0,1) 滑入、标题 16/700 + 圆形关闭钮；底栏不放底色；内容区各页用 hairline 分组，不要整块实底包裹。
- 密钥输入：`type="text"` + `[-webkit-text-security:disc]` CSS 掩码（WKWebView/Chromium 均支持），不用 `type="password"`，避免触发密码管理器且保持掩码显示。

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
