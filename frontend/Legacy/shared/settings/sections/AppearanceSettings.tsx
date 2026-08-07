import { ArrowUpRight } from "lucide-react";

import { useAppPreferences } from "../../theme/appPreferences";
import { resolveAppearance } from "../../theme/appearance";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { AppearanceBackgroundSection } from "./appearance/AppearanceBackgroundSection";
import { HomeContentSection } from "./appearance/HomeContentSection";
import { ImmersiveModeSection } from "./appearance/ImmersiveModeSection";
import { SceneClaritySection } from "./appearance/SceneClaritySection";
import { SurfaceTransparencySection } from "./appearance/SurfaceTransparencySection";
import { ThemePresetSection } from "./appearance/ThemePresetSection";
import "../styles/appearance-settings.css";
import "../styles/theme-presets.css";

export function AppearanceSettings({ onClose }: { onClose: () => void }) {
  const preferences = useAppPreferences((state) => state.preferences);
  const resolved = resolveAppearance(preferences);

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Appearance"
        title="外观与主题"
        description="主题负责色彩与基调；每个主题单独保存背景图片与显影参数，首页文案和区域透光作为设备级通用偏好保存。"
        onClose={onClose}
      />

      <div className="appearance-settings">
        <section className="appearance-new-interface" aria-labelledby="new-interface-title">
          <div>
            <span className="eyebrow">New interface</span>
            <h3 id="new-interface-title">终末地风格新界面</h3>
            <p>进入暖白、碳黑与工业黄构成的全新管理界面；经典主题偏好仍会保留。</p>
          </div>
          <a href="/?theme=dial-archive">
            <span>进入新主题</span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </section>
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
