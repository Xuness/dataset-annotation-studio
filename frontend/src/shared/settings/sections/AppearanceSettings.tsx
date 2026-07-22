import { useAppPreferences } from "../../theme/appPreferences";
import { resolveAppearance } from "../../theme/appearance";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { AppearanceBackgroundSection } from "./appearance/AppearanceBackgroundSection";
import { HomeContentSection } from "./appearance/HomeContentSection";
import { ImmersiveModeSection } from "./appearance/ImmersiveModeSection";
import { SceneClaritySection } from "./appearance/SceneClaritySection";
import { SurfaceTransparencySection } from "./appearance/SurfaceTransparencySection";
import { ThemePresetSection } from "./appearance/ThemePresetSection";

export function AppearanceSettings({ onClose }: { onClose: () => void }) {
  const preferences = useAppPreferences((state) => state.preferences);
  const resolved = resolveAppearance(preferences);

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Appearance"
        title="外观与主题"
        description="主题负责色彩与基调；每个主题单独保存背景图片，首页文案、显影参数和区域透光作为设备级偏好保存。"
        onClose={onClose}
      />

      <div className="appearance-settings">
        <AppearanceBackgroundSection />
        <HomeContentSection />
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
