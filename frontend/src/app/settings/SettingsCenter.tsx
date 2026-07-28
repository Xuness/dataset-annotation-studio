import { Suspense } from "react";
import { Settings } from "lucide-react";

import { UpdateAnnouncementIndicator } from "../../features/updateAnnouncements/UpdateAnnouncementIndicator";
import { useHasUnreadUpdateAnnouncement } from "../../features/updateAnnouncements/readState";
import { useSettingsCenter } from "../../shared/settings/settingsCenterStore";
import { ModalLayer } from "../../shared/ui/ModalLayer";
import { Spinner } from "../../shared/ui/Spinner";
import "../../shared/settings/settings-center.css";
import { SETTINGS_SECTIONS } from "./settingsSections";

export function SettingsCenter() {
  const isOpen = useSettingsCenter((state) => state.isOpen);
  const section = useSettingsCenter((state) => state.section);
  const close = useSettingsCenter((state) => state.close);
  const open = useSettingsCenter((state) => state.open);
  const hasUnreadUpdateAnnouncement = useHasUnreadUpdateAnnouncement();
  const activeSection =
    SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ?? SETTINGS_SECTIONS[0];
  const ActiveSection = activeSection.component;

  return (
    <ModalLayer
      open={isOpen}
      onClose={close}
      backdropClassName="settings-center-backdrop"
      panelClassName="settings-center"
      labelledBy="settings-center-title"
      initialFocusSelector="[data-settings-close]"
    >
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
            const showUnreadIndicator = entry.id === "announcements" && hasUnreadUpdateAnnouncement;
            return (
              <button
                type="button"
                key={entry.id}
                className={section === entry.id ? "is-active" : ""}
                aria-current={section === entry.id ? "page" : undefined}
                aria-label={showUnreadIndicator ? `${entry.label}，有未读更新公告` : undefined}
                onClick={() => open(entry.id)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{entry.label}</span>
                {showUnreadIndicator ? <UpdateAnnouncementIndicator /> : null}
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
    </ModalLayer>
  );
}
