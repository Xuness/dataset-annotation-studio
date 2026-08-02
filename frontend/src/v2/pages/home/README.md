# 新前端首页多方案协作约定

首页支持多个视觉方案并存。每个模型或设计实验必须拥有独立目录，不覆盖另一个方案，也不复制业务层。
`src/v2` 只是代码代际目录；当前默认方案 `dial-archive` 不是新前端的通用视觉模板。

## 接手起点

开始修改前先阅读：

1. `docs/frontend-v2-architecture.md`：跨层依赖、入口与共享契约。
2. `navigation/spaceRegistry.ts`：首页一级空间的唯一语义来源。
3. `homeVariantRegistry.ts` 与 `HomeVariantHost.tsx`：方案发现、选择和回退行为。
4. 自己负责的 `variants/<variant-id>/`；其它方案只用于比较，不作为待重构代码。

先运行 `git status --short`，保留用户和其它模型已有的未提交修改。

## 新增方案的最小步骤

在 `variants/<variant-id>/index.tsx` 提供默认导出的 React 页面组件：

```tsx
export { ModelAHomePage as default } from "./ModelAHomePage";
```

`variant-id` 只使用小写字母、数字和连字符。根类、CSS 变量、测试 ID 与动画名称使用同一个方案前缀，
不要使用含糊的 `v2-*` 作为视觉命名。入口会自动发现该目录，不需要修改共享注册表。通过以下地址分别预览：

```text
/?home=dial-archive
/?home=<variant-id>
```

未注册或拼写错误的 ID 会回退到 `dial-archive`，不会生成空白首页。
单个方案发生运行时渲染错误时，新前端错误边界会提供默认方案和 Legacy 两条恢复入口。
改变 `DEFAULT_HOME_VARIANT_ID` 是共享产品决策，不能夹带在单个方案实现中。

## 文件所有权

一个方案默认只能修改自己的 `variants/<variant-id>/`。以下内容视为共享契约，比较视觉方案时不得顺手改写：

- `spaceRegistry.ts`：一级空间的稳定语义与顺序。
- `homeVariantRegistry.ts`、`HomeVariantHost.tsx`：自动发现和选择机制。
- `src/v2/styles/`：新前端入口级 reset 与宿主状态样式。
- `src/application`、`src/features`、`src/shared`：业务、API、状态和桌面端口。
- `frontend/Legacy` 与 `legacy.html`：旧界面稳定入口。

确实需要修改共享契约时，应单独提交，不与某个视觉方案混在一起。
不要把终末地方案复制到新目录后逐层覆盖；独立方案应从空目录建立，只复用稳定语义和业务能力。
只有第二个已确认方案出现真实重复后，才讨论抽取共享视觉组件。

## 样式与运行隔离

- 每个方案使用唯一根类和类名前缀，例如 `.model-a-home`、`.model-a-disc`。
- 方案 CSS 必须从自己的入口导入；不得修改 Legacy CSS、复用 Legacy 主题变量或写无范围的元素选择器。
- 通用宿主不提供视觉主题令牌；每个方案在自己的根类下维护颜色、字体、几何和动效变量。
- `dial-archive` 只使用 `dial-archive-*` 类名和 `--dial-archive-*` 变量，不得把它们提升为新前端通用风格。
- SVG `defs` ID、DOM ID 和测试 ID 必须实例唯一；使用 React `useId()`，不要写 `gradient`、`clip` 等全局固定 ID。
- DOM 查询限制在本方案根节点，禁止用 `document.querySelector` 寻找方案内部元素。
- React 选中状态负责内容预览和无障碍语义；瞬时悬浮抬升使用原生 `:hover` / `:focus-visible`，不得用持久
  `data-active` 维持浮起，也不得依赖 React 重渲染追赶鼠标。
- 指针位置等高频输入通过 `requestAnimationFrame` 写方案私有 CSS 变量，并在离开、失焦和卸载时复位。
- 悬浮元素必须分离固定命中层与可动视觉层：外层语义按钮保持位置和命中几何不变，内部视觉层承担
  `transform`、裁切与阴影，并设置 `pointer-events: none`。
- 同类可用入口必须有一致反馈；禁用项不得出现悬浮线、抬升或可点击光标。
- 必须支持 `prefers-reduced-motion`，并确保禁用动画后仍能辨认聚焦和选中状态。

## 内容与能力边界

- 首页不查询最近项目、任务统计或其它业务数据。
- 方案从 `spaceRegistry.ts` 读取首页空间，不建立第二份名称、路由或职责清单。
- 页面不得直接 `fetch`、拼 API URL、调用 Tauri 包或导入 Legacy 表现层。
- 参考图、官网抓取字体、图片、视频和音频不能进入发行源码；只使用原创或授权明确的资产。

## 验收

每个方案至少提供：

- 注册、默认构图与关键交互的行为测试。
- 固定命中层/可动视觉层、悬浮与选中状态分离等容易回退的源码契约测试。
- 1920 × 1080 和 1366 × 768 实际截图。
- 快速跨模块悬浮、键盘方向键、`Tab` / `Enter` 和减少动态检查。
- 浏览器真实命中检查；JSDOM 事件测试不能证明 `:hover`、层叠、裁切和动画在浏览器中正确。
- `pnpm --dir frontend check` 与 `pnpm --dir frontend build` 通过记录。

截图和临时预览产物不提交到仓库。视觉比较完成前，不以删除其它方案的方式“清理代码”。

## 交接记录

交给下一个模型时至少写明：

```text
方案 ID：
预览 URL：
方案目录：
共享契约改动：无 / 具体文件与原因
已运行检查：
已知视觉或交互问题：
Git 状态：未提交 / 已提交（提交号）
```
