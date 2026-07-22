import { X } from "lucide-react";

import { useAppPreferences } from "../../theme/appPreferences";
import { resolveAppearance } from "../../theme/appearance";
import { AppearanceBackgroundSection } from "./appearance/AppearanceBackgroundSection";
import { ImmersiveModeSection } from "./appearance/ImmersiveModeSection";
import { SceneClaritySection } from "./appearance/SceneClaritySection";
import { SurfaceTransparencySection } from "./appearance/SurfaceTransparencySection";
import { ThemePresetSection } from "./appearance/ThemePresetSection";

export function AppearanceSettings({ onClose }: { onClose: () => void }) {
  const preferences = useAppPreferences((state) => state.preferences);
  const resolved = resolveAppearance(preferences);

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Appearance</span>
          <h2>外观与主题</h2>
          <p>
            主题负责色彩与基调；每个主题单独保存背景图片，显影参数和区域透光作为通用覆盖层保存。
          </p>
        </div>
        <button
          type="button"
          className="settings-center__close"
          data-settings-close=""
          onClick={onClose}
          aria-label="关闭设置"
          title="关闭设置"
        >
          <X size={18} />
        </button>
      </header>

      <div className="appearance-settings">
        <AppearanceBackgroundSection />
        <ImmersiveModeSection />
        <SceneClaritySection />
        <SurfaceTransparencySection />
        <ThemePresetSection />
      </div>

      <footer>
        <span>外观设置仅保存在当前设备</span>
        <span>
          {resolved.customBackground
            ? `${resolved.theme.name} · 自定义背景`
            : `当前主题 · ${resolved.theme.name}`}
        </span>
      </footer>
    </>
  );
}
