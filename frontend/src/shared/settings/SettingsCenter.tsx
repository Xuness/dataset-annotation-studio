import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Check, Palette, Settings, X } from "lucide-react";

import { useAppPreferences } from "../theme/appPreferences";
import { THEMES } from "../theme/themes";
import { useSettingsCenter } from "./settingsCenterStore";
import "./settings-center.css";

export function SettingsCenter() {
  const isOpen = useSettingsCenter((state) => state.isOpen);
  const section = useSettingsCenter((state) => state.section);
  const close = useSettingsCenter((state) => state.close);
  const themeId = useAppPreferences((state) => state.themeId);
  const setTheme = useAppPreferences((state) => state.setTheme);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (document.activeElement instanceof HTMLElement) {
        restoreFocusRef.current = document.activeElement;
      }
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-settings-close]")?.focus();
      return;
    }

    if (dialog.open) dialog.close();
    const restoreFocus = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restoreFocus?.isConnected) restoreFocus.focus();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="settings-center-backdrop"
      aria-labelledby="settings-center-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outsideDialog =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outsideDialog) close();
      }}
    >
      <div className="settings-center">
        <aside className="settings-center__sidebar">
          <div className="settings-center__brand">
            <span aria-hidden="true">
              <Settings size={16} />
            </span>
            <div>
              <strong id="settings-center-title">设置</strong>
              <small>Dataset Studio</small>
            </div>
          </div>
          <nav aria-label="设置分类">
            <button type="button" className={section === "themes" ? "is-active" : ""}>
              <Palette size={15} aria-hidden="true" />
              <span>主题预设</span>
            </button>
          </nav>
          <p>设置保存在此设备上，不会写入数据集项目。</p>
        </aside>

        <section className="settings-center__content">
          <header>
            <div>
              <span className="eyebrow">Appearance</span>
              <h2>主题预设</h2>
              <p>一套主题同时控制首页场景与主工作区的色彩、表面和氛围。</p>
            </div>
            <button
              type="button"
              className="settings-center__close"
              data-settings-close=""
              onClick={close}
              aria-label="关闭设置"
              title="关闭设置"
            >
              <X size={18} />
            </button>
          </header>

          <div className="theme-preset-grid">
            {THEMES.map((theme) => {
              const selected = theme.id === themeId;
              const previewStyle = {
                "--theme-preview-image": `url("${theme.sceneImage}")`,
                "--theme-preview-position": theme.previewPosition,
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

          <footer>
            <span>主题切换会立即生效</span>
            <span>保存在当前设备</span>
          </footer>
        </section>
      </div>
    </dialog>
  );
}
