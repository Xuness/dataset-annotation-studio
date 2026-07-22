import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import {
  chooseCustomBackground,
  clearCustomBackground,
  supportsCustomBackgrounds,
} from "../../../desktop/customBackground";
import { useAppPreferences } from "../../../theme/appPreferences";
import { resolveAppearance } from "../../../theme/appearance";
import { Button } from "../../../ui/Button";
import { Spinner } from "../../../ui/Spinner";

export function AppearanceBackgroundSection() {
  const preferences = useAppPreferences((state) => state.preferences);
  const setThemeCustomBackground = useAppPreferences((state) => state.setThemeCustomBackground);
  const [backgroundPending, setBackgroundPending] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const resolved = resolveAppearance(preferences);
  const customBackground = resolved.customBackground;
  const backgroundSupported = supportsCustomBackgrounds();

  async function selectBackground() {
    setBackgroundError(null);
    setBackgroundPending(true);
    try {
      const selected = await chooseCustomBackground(
        resolved.theme.id,
        customBackground?.path ?? null,
      );
      if (selected) setThemeCustomBackground(resolved.theme.id, selected);
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : "无法保存自定义背景图片。");
    } finally {
      setBackgroundPending(false);
    }
  }

  async function removeBackground() {
    if (!customBackground) return;

    const themeId = resolved.theme.id;
    const backgroundPath = customBackground.path;
    setBackgroundError(null);
    setThemeCustomBackground(themeId, null);
    setBackgroundPending(true);
    try {
      await clearCustomBackground(themeId, backgroundPath);
    } catch (error) {
      setBackgroundError(
        error instanceof Error
          ? `已恢复主题背景，但旧图片暂未清理：${error.message}`
          : "已恢复主题背景，但旧图片暂未清理。",
      );
    } finally {
      setBackgroundPending(false);
    }
  }

  return (
    <section className="appearance-section appearance-background">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Theme scene</span>
          <h3>“{resolved.theme.name}”背景</h3>
        </div>
        <small>PNG · JPEG · WebP，最大 64 MB</small>
      </div>
      <div className="appearance-background__body">
        <div className="appearance-background__preview" aria-hidden="true">
          <span />
          <i>{customBackground ? "CUSTOM SCENE" : resolved.theme.englishName}</i>
        </div>
        <div className="appearance-background__copy">
          <strong>{customBackground?.name ?? `使用“${resolved.theme.name}”自带场景`}</strong>
          <p>
            {customBackground
              ? `图片仅用于“${resolved.theme.name}”，并已复制到本地数据目录；移动或删除原图不会影响显示。`
              : `选择后会同时用于“${resolved.theme.name}”的首页和主工作区；切换主题会显示各自的背景。`}
          </p>
          <div>
            <Button
              icon={backgroundPending ? <Spinner /> : <ImagePlus size={14} />}
              onClick={() => void selectBackground()}
              disabled={backgroundPending || !backgroundSupported}
            >
              {customBackground ? "更换图片" : "选择图片"}
            </Button>
            {customBackground ? (
              <Button
                icon={<Trash2 size={14} />}
                onClick={() => void removeBackground()}
                disabled={backgroundPending}
              >
                恢复主题背景
              </Button>
            ) : null}
          </div>
          {!backgroundSupported ? (
            <small className="appearance-background__hint">请在桌面版中选择本地图片。</small>
          ) : null}
          {backgroundError ? <small className="form-error">{backgroundError}</small> : null}
        </div>
      </div>
    </section>
  );
}
