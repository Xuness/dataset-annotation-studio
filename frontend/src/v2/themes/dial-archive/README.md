# Dial Archive frontend theme

`dial-archive` 是当前默认的完整前端主题，不是 V2 的通用样式。它将断环仪首页的终末地式工业终端语言与
项目档案空间的莱茵式档案语法组织在同一个可替换主题包中。预览入口为
`/?theme=dial-archive`，`?s=1..6` 只用于固定首页初始空间与截图。

## 所有权

```text
index.tsx             主题页面插槽导出
home/                 首页构图、断环组件、画布适配、弹簧模型与私有样式
spaces/               六空间骨架、项目档案页、数据整备二三级页、页内切换动效与私有样式
components/           首页和空间页都已使用的主题原语
hooks/                跨主题页面复用的时钟与减少动态查询
model/                共享空间视觉码与表现映射
styles/               主题字体声明和共享令牌；不进入 V2 中立样式
assets/fonts/         OFL 字体、许可与子集说明
```

稳定空间语义只来自 `v2/navigation/spaceRegistry.ts`。主题私有的 `ARC / PRP / ANN` 代码、巨型幽灵字、
断环几何和动效参数留在本目录。工作区查询、文件夹选择、当前项目 Store 和本地目录打开动作由
V2 中立层负责：`v2/app/useProjectRouteContext.ts` 管理 `project` URL 上下文并同步 Store，
`v2/pages/spaces/archive/useArchiveSpaceController.ts` 负责项目业务动作。主题只消费视图模型与回调。
数据整备的中立投影和控制器位于 `v2/pages/spaces/preparation/`；主题私有实现位于
`spaces/preparation/`，其中二级页保持白色滚动文档，三级页使用独立暗色任务画布，但两者都只消费同一
`SpacePageContent` 联合类型。

### 数据整备三级画布的事实源

- `spaces/preparation/model/preparationCanvasLayout.ts` 是三级画布唯一的空间事实源，集中管理世界尺寸、
  镜头参数、节点矩形、端口与拓扑边、背景取景框、装饰锚点和小地图投影。移动节点只修改这里的 `rect`；
  连线端点、点击后的镜头中心与小地图标记会自动派生，不得再在 TSX 或 CSS 中镜像 `top / left`。
- 拓扑边同样只在布局模型中声明。节点移动不需要重写 SVG `d`；只有确实要改变曲线手势时才调整对应边的
  `fromControl / toControl`。纯装饰虚线没有业务端点，也仍集中留在该模型的 `decorPaths`。
- `spaces/preparation/model/preparationPresentation.ts` 是整备能力与画布节点代码、标题和说明的主题私有
  文案映射，二级能力入口、三级节点和检查器共同消费；不要在组件里再建一份标题表。
- `spaces/preparation/hooks/usePreparationCanvasMotion.ts` 只负责镜头运行时。它从布局模型读取缩放与手感参数，
  通过真实检查器矩形计算可见区域，并直接同步画布 transform 与小地图视窗；拖拽、缩放等高频值不得进入
  React state。

## 交互约束

- 首页的选中、指针预览、焦点预览和内容落位保持分离；移动圆环不拥有悬停命中。
- 首页“进入空间”先完成黄色扫幕，再把语义空间 ID 交给中立路由。
- 空间页使用一个可滚动文档上下文；顶部 chrome 和左侧 01–06 轨道固定在主题根内。
- 首页、空间轨道和 HOME 返回动作由中立路由保留当前 `project` 上下文；主题不得读取或拼接查询参数。
- 轨道切换先移动左侧黄色游标，再以处于内容下方的实色黄色扫描带完成交接；页面本体不做模糊或透明淡化。
- 项目索引只聚焦一个真实本地工作区，不保留探索稿里的模拟项目。
- 项目详情与整备二级页处于白色文档流中，不使用旧版米色卡片。
- 整备三级页可以脱离左侧六空间轨道进入暗色自由画布；它必须保留顶部空间身份和返回动作，并通过中立
  控制器使用真实预演、执行、进度与恢复数据，不得伪造节点百分比。
- 整备画布的 `GEOMETRY / ENCODING / IDENTITY` 是可并行、可旁路的方案节点；运行时只显示后端已经提供的
  操作级共享进度，使用 `FUSED / SHARED PASS` 解释融合处理，不把总进度拆成虚假的阶段进度。
- 操作存在时，节点、主连线和信号流都以该操作冻结的 `capabilities` 为准；只有尚未建立操作时才读取当前
  表单开关。不得让节点和连线分别消费两套参与状态。
- 所有 DOM 查询限制在本主题持有的根 ref；高频动画使用 Web Animations / CSS，不进入逐帧 React 状态。
- 快速重复切换会取消旧计时器和动画，只提交最后一次空间意图；减少动态时直接完成语义导航。

## 变更规则

所有类名、变量和 keyframes 使用 `dial-archive` 前缀。不要把主题字体、配色、圆环、轨道或项目展台提升到
`v2/styles` 或 `v2/pages`；不要导入 Legacy 表现代码、直接 `fetch` 或直接调用 Tauri 包。改变主题页面
插槽或 `SpacePageContent` 属于共享契约改动，需要单独说明影响范围。
