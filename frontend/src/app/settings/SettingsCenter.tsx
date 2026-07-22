import { Suspense, useLayoutEffect, useRef } from "react";
import { Settings } from "lucide-react";

import { useSettingsCenter } from "../../shared/settings/settingsCenterStore";
import { Spinner } from "../../shared/ui/Spinner";
import "../../shared/settings/settings-center.css";
import { SETTINGS_SECTIONS } from "./settingsSections";

export function SettingsCenter() {
  const isOpen = useSettingsCenter((state) => state.isOpen);
  const section = useSettingsCenter((state) => state.section);
  const close = useSettingsCenter((state) => state.close);
  const open = useSettingsCenter((state) => state.open);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const activeSection =
    SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ?? SETTINGS_SECTIONS[0];
  const ActiveSection = activeSection.component;

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
            {SETTINGS_SECTIONS.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  type="button"
                  key={entry.id}
                  className={section === entry.id ? "is-active" : ""}
                  aria-current={section === entry.id ? "page" : undefined}
                  onClick={() => open(entry.id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </nav>
          <p>{activeSection.sidebarNote}</p>
        </aside>

        <section className="settings-center__content">
          <Suspense
            fallback={
              <div className="settings-section-loading">
                <Spinner label={`读取${activeSection.label}`} />
              </div>
            }
          >
            <ActiveSection onClose={close} />
          </Suspense>
        </section>
      </div>
    </dialog>
  );
}
