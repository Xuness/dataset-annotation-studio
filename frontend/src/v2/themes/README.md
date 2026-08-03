# 新前端完整主题协作约定

V2 是视觉中立的新前端架构，不是终末地、莱茵生命或任何其它视觉风格的名称。一个主题必须覆盖产品所需的
页面插槽，不能只注册一张首页后再把同一风格的二级页散落到公共页面目录。

## 新增主题

在 `themes/<theme-id>/index.tsx` 命名导出：

```tsx
export { ExampleHomePage as HomePage } from "./home/ExampleHomePage";
export { ExampleSpacePage as SpacePage } from "./spaces/ExampleSpacePage";
```

注册表通过目录自动发现主题。`theme-id` 只使用小写字母、数字和连字符；根类、CSS 变量、测试 ID 与动画
名称使用同一主题前缀。通过 `/?theme=<theme-id>` 预览，未知 ID 回退到默认主题。

## 主题与产品层的分工

- `app/` 拥有 Provider、URL 和路由装配。
- `navigation/spaceRegistry.ts` 拥有六空间的 ID、顺序、名称、职责和稳定路径。
- `pages/spaces/` 拥有 API 查询、桌面端口、跨页面 Store 与视觉中立视图模型。
- `themes/<theme-id>/` 只拥有页面构图、组件、字体、配色、几何、局部交互和动效。
- `Legacy/` 是整页隔离的旧表现层，不得被主题导入。

主题首页只发出 `onEnterSpace(spaceId)`；主题空间页只发出 `onNavigateSpace(spaceId)` 与
`onReturnHome(spaceId)`。主题不得自行调用 React Router、拼接 API、直接调用 Tauri 包或读取其它主题的
内部文件。需要项目数据时消费 `SpacePageContent`，不得在主题中建立第二套 DTO 或假项目列表。
当前项目使用中立路由的 `project` 查询参数表达，并由 `app/useProjectRouteContext.ts` 同步到共享 Store；
主题不得为了恢复项目上下文读取 `window.location` 或自行维护第二套项目选择状态。

只有至少两个同主题页面已经真实使用某段视觉能力时，才将它提到该主题根目录；跨主题公共层仍不得承载
配色、字体、几何或动效。所有样式必须由唯一根类限定范围，并支持键盘、快速连续输入和
`prefers-reduced-motion`。

## 验收

主题至少需要行为测试、纯模型测试、样式源码契约与真实浏览器检查。交付前运行 V2 范围测试、架构检查、
TypeScript、全量 `check`、正式构建和 `git diff --check`。截图和临时预览产物不得提交。
