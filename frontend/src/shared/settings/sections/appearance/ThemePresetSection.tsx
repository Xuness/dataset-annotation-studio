import type { CSSProperties } from "react";
import { Check } from "lucide-react";

import { useAppPreferences } from "../../../theme/appPreferences";
import { DEFAULT_THEME_ID, THEMES } from "../../../theme/themes";

export function ThemePresetSection() {
  const preferences = useAppPreferences((state) => state.preferences);
  const setTheme = useAppPreferences((state) => state.setTheme);

  return (
    <section className="appearance-section">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Theme registry</span>
          <h3>主题预设</h3>
        </div>
        <small>每个主题分别保存背景图片</small>
      </div>
      <div className="theme-preset-grid">
        {THEMES.map((theme) => {
          const selected = theme.id === preferences.themeId;
          const hasCustomBackground = Boolean(preferences.appearance.customBackgrounds[theme.id]);
          const previewStyle = {
            "--theme-preview-image": `url(${JSON.stringify(theme.scene.image)})`,
            "--theme-preview-position": theme.scene.previewPosition,
            "--theme-preview-backdrop": theme.swatches[0],
            "--theme-preview-surface": theme.swatches[1],
            "--theme-preview-ink": theme.swatches[2],
            "--theme-preview-accent": theme.swatches[3],
          } as CSSProperties;
          return (
            <button
              type="button"
              key={theme.id}
              className={`theme-preset-card ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => setTheme(theme.id)}
            >
              <span className="theme-preset-card__preview" style={previewStyle}>
                <span className="theme-preset-card__frame" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                {selected ? (
                  <span className="theme-preset-card__selected">
                    <Check size={13} /> 当前主题
                  </span>
                ) : null}
              </span>
              <span className="theme-preset-card__copy">
                <span>
                  <strong>{theme.name}</strong>
                  {theme.id === DEFAULT_THEME_ID ? <em>默认</em> : null}
                  {hasCustomBackground ? <em>自定义</em> : null}
                  <small>{theme.englishName}</small>
                </span>
                <span className="theme-preset-card__swatches" aria-hidden="true">
                  {theme.swatches.map((color) => (
                    <i key={color} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span>{theme.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
