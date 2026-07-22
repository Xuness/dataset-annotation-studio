import { Check } from "lucide-react";

import { useAppPreferences } from "../../../theme/appPreferences";
import { APP_SURFACE_REGIONS, type AppSurfaceRegion } from "../../../theme/appearance";
import { confirmDialog } from "../../../ui/dialogs";

interface SurfaceRegionPresentation {
  title: string;
  scope: string;
  description: string;
  wide?: boolean;
}

const surfaceRegionPresentation: Record<AppSurfaceRegion, SurfaceRegionPresentation> = {
  "desktop-titlebar": {
    title: "桌面标题栏",
    scope: "整个应用",
    description: "让最上方的 Dataset Studio 窗口栏透出当前页面使用的主题或自定义场景。",
    wide: true,
  },
  "home-topbar": {
    title: "首页导航栏",
    scope: "首页",
    description: "让显示预设与连接、设置的顶部栏透出首页迎宾场景。",
    wide: true,
  },
  "home-entry": {
    title: "首页入口按钮",
    scope: "打开数据集",
    description: "移除打开数据集入口的玻璃底板，让按钮直接悬浮在迎宾场景上。",
  },
  "home-recents": {
    title: "最近项目卡片",
    scope: "最近项目",
    description: "让三张最近项目卡片以及加载、空状态区域透出首页背景。",
  },
  canvas: {
    title: "图片画布",
    scope: "素材 · 审核",
    description: "移除网格与画布底色，让场景直接衬在图片背后。",
  },
  navigation: {
    title: "功能导航",
    scope: "全部工作页",
    description: "让最左侧的页面入口栏透出工作区背景。",
  },
  "primary-sidebar": {
    title: "左侧功能栏",
    scope: "列表 · 参数",
    description: "覆盖素材列表、任务创建以及预处理和导出参数栏。",
  },
  content: {
    title: "中央内容区",
    scope: "编辑 · 预览",
    description: "覆盖标注编辑器、任务列表和各种执行预览。",
  },
  "secondary-sidebar": {
    title: "右侧详情栏",
    scope: "检查器 · 历史",
    description: "覆盖素材检查器、任务详情和操作历史。",
  },
  chrome: {
    title: "工作区框架",
    scope: "顶栏 · 状态栏",
    description: "让工作区顶栏和底部状态栏也融入场景。",
  },
};

export function SurfaceTransparencySection() {
  const transparentRegions = useAppPreferences(
    (state) => state.preferences.appearance.transparentRegions,
  );
  const immersiveMode = useAppPreferences((state) => state.preferences.appearance.immersiveMode);
  const setRegionTransparency = useAppPreferences((state) => state.setRegionTransparency);
  const setAllRegionsTransparent = useAppPreferences((state) => state.setAllRegionsTransparent);
  const resetRegionTransparency = useAppPreferences((state) => state.resetRegionTransparency);
  const setImmersiveMode = useAppPreferences((state) => state.setImmersiveMode);
  const allRegionsTransparent = APP_SURFACE_REGIONS.every((region) => transparentRegions[region]);

  async function toggleRegionTransparency(region: AppSurfaceRegion, title: string) {
    if (immersiveMode) {
      const exitImmersiveMode = await confirmDialog(
        `当前处于沉浸模式，区域透光由沉浸模式统一控制。请先退出沉浸模式，再修改“${title}”。`,
        {
          title: "沉浸模式正在生效",
          confirmLabel: "退出沉浸模式",
          cancelLabel: "暂不退出",
        },
      );
      if (exitImmersiveMode) setImmersiveMode(false);
      return;
    }

    setRegionTransparency(region, !transparentRegions[region]);
  }

  return (
    <section className="appearance-section">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Surface permeability</span>
          <h3>区域透光</h3>
        </div>
        <small>界面材质可独立开关</small>
      </div>
      <div className="surface-transparency">
        <div className="surface-transparency__summary">
          <div>
            <strong>让背景穿过窗口与界面底板</strong>
            <p>
              只改变列出的栏位与卡片底板；输入框、告警和选中态仍保留必要遮罩，避免全透明时失去可读性。
            </p>
          </div>
          <button
            type="button"
            className={immersiveMode || allRegionsTransparent ? "is-active" : ""}
            aria-pressed={immersiveMode || allRegionsTransparent}
            disabled={immersiveMode}
            onClick={allRegionsTransparent ? resetRegionTransparency : setAllRegionsTransparent}
          >
            {immersiveMode ? "由沉浸模式控制" : allRegionsTransparent ? "恢复建议" : "全部透明"}
          </button>
        </div>
        <div className={`surface-transparency__grid ${immersiveMode ? "is-managed" : ""}`}>
          {APP_SURFACE_REGIONS.map((region) => {
            const option = surfaceRegionPresentation[region];
            const transparent = immersiveMode || transparentRegions[region];
            return (
              <button
                type="button"
                key={region}
                className={`surface-transparency__option ${
                  option.wide ? "surface-transparency__option--wide" : ""
                } ${transparent ? "is-active" : ""}`}
                aria-pressed={transparent}
                aria-disabled={immersiveMode}
                onClick={() => void toggleRegionTransparency(region, option.title)}
              >
                <span className="surface-transparency__check" aria-hidden="true">
                  {transparent ? <Check size={12} /> : null}
                </span>
                <span className="surface-transparency__copy">
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
                <em>{option.scope}</em>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
