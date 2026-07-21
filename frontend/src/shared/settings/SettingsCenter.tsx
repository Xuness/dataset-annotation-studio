import { useLayoutEffect, useRef } from "react";
import { Palette, Settings } from "lucide-react";

import { AppearanceSettings } from "./sections/AppearanceSettings";
import { useSettingsCenter } from "./settingsCenterStore";
import "./settings-center.css";

export function SettingsCenter() {
  const isOpen = useSettingsCenter((state) => state.isOpen);
  const section = useSettingsCenter((state) => state.section);
  const close = useSettingsCenter((state) => state.close);
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
            <button type="button" className={section === "appearance" ? "is-active" : ""}>
              <Palette size={15} aria-hidden="true" />
              <span>外观与主题</span>
            </button>
          </nav>
          <p>设置保存在此设备上，不会写入数据集项目。</p>
        </aside>

        <section className="settings-center__content">
          {section === "appearance" ? <AppearanceSettings onClose={close} /> : null}
        </section>
      </div>
    </dialog>
  );
}
