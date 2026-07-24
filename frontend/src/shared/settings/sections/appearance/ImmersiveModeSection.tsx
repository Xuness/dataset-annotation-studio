import { isTauri } from "@tauri-apps/api/core";

import { usesNativeDesktopWindowDecorations } from "../../../desktop/runtimePlatform";
import { useAppPreferences } from "../../../theme/appPreferences";

export function ImmersiveModeSection() {
  const immersiveMode = useAppPreferences((state) => state.preferences.appearance.immersiveMode);
  const setImmersiveMode = useAppPreferences((state) => state.setImmersiveMode);
  const nativeWindowDecorations = usesNativeDesktopWindowDecorations(isTauri());

  return (
    <section className="appearance-section">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Immersive workspace</span>
          <h3>沉浸模式</h3>
        </div>
        <small>关闭后恢复原有区域选择</small>
      </div>
      <button
        type="button"
        className={`immersive-mode-card ${immersiveMode ? "is-active" : ""}`}
        aria-pressed={immersiveMode}
        onClick={() => setImmersiveMode(!immersiveMode)}
      >
        <span className="immersive-mode-card__mark" aria-hidden="true" />
        <span className="immersive-mode-card__copy">
          <strong>让工作台完全沉入场景</strong>
          <small>
            {nativeWindowDecorations
              ? "强制开启首页卡片与全部应用内容区域透光，并隐藏面板边界、栏位分隔和常驻拖拽线；系统标题栏保持桌面环境原生样式。"
              : "强制开启标题栏、首页卡片与全部工作区域透光，并隐藏面板边界、栏位分隔和常驻拖拽线；输入控件与状态提示仍保留必要轮廓。"}
          </small>
        </span>
        <span className="immersive-mode-card__state">
          <i aria-hidden="true" />
          {immersiveMode ? "已开启" : "未开启"}
        </span>
      </button>
    </section>
  );
}
