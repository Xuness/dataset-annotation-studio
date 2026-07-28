import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  History,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";

import {
  LATEST_UPDATE_ANNOUNCEMENT,
  UPDATE_ANNOUNCEMENTS,
  type UpdateAnnouncement,
  type UpdateAnnouncementSectionKind,
} from "../../../features/updateAnnouncements/catalog";
import { useUpdateAnnouncementReadState } from "../../../features/updateAnnouncements/readState";
import { SettingsSectionHeader } from "../../../shared/settings/components/SettingsSectionHeader";
import "../../../shared/settings/styles/update-announcements-settings.css";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SECTION_ICONS: Record<UpdateAnnouncementSectionKind, LucideIcon> = {
  feature: Sparkles,
  improvement: CheckCircle2,
  fix: Wrench,
  notice: CircleAlert,
};

function formatPublishedAt(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function AnnouncementSections({ announcement }: { announcement: UpdateAnnouncement }) {
  return (
    <div className="update-announcement__groups">
      {announcement.sections.map((section) => {
        const Icon = SECTION_ICONS[section.kind];
        return (
          <section key={section.kind} data-kind={section.kind}>
            <div className="update-announcement__group-title">
              <Icon size={15} aria-hidden="true" />
              <h4>{section.title}</h4>
            </div>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AnnouncementMetadata({ announcement }: { announcement: UpdateAnnouncement }) {
  return (
    <div className="update-announcement__metadata">
      <span>源码预览版 · {announcement.version}</span>
      <time dateTime={announcement.publishedAt}>
        <CalendarDays size={13} aria-hidden="true" />
        {formatPublishedAt(announcement.publishedAt)}
      </time>
    </div>
  );
}

export function UpdateAnnouncementsSettings({ onClose }: { onClose: () => void }) {
  const markLatestAnnouncementRead = useUpdateAnnouncementReadState(
    (state) => state.markLatestAnnouncementRead,
  );
  const historicalAnnouncements = UPDATE_ANNOUNCEMENTS.slice(1);

  useEffect(() => {
    markLatestAnnouncementRead();
  }, [markLatestAnnouncementRead]);

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Release notes"
        title="更新公告"
        description="记录源码预览版近期新增、改进与修复的内容。"
        onClose={onClose}
      />

      <div className="update-announcements-settings">
        <section aria-labelledby="latest-announcement-title">
          <div className="update-announcements-heading">
            <div>
              <span className="eyebrow">Latest</span>
              <h3 id="latest-announcement-title">本次更新</h3>
            </div>
            <span className="update-announcements-heading__status">
              <CheckCircle2 size={14} aria-hidden="true" />
              已查看
            </span>
          </div>

          <article className="update-announcement update-announcement--latest">
            <AnnouncementMetadata announcement={LATEST_UPDATE_ANNOUNCEMENT} />
            <h3>{LATEST_UPDATE_ANNOUNCEMENT.title}</h3>
            <p className="update-announcement__summary">{LATEST_UPDATE_ANNOUNCEMENT.summary}</p>
            <AnnouncementSections announcement={LATEST_UPDATE_ANNOUNCEMENT} />
          </article>
        </section>

        <section aria-labelledby="announcement-history-title">
          <div className="update-announcements-heading">
            <div>
              <span className="eyebrow">Archive</span>
              <h3 id="announcement-history-title">历史版本</h3>
            </div>
            <History size={17} aria-hidden="true" />
          </div>

          <div className="update-announcement-history">
            {historicalAnnouncements.map((announcement) => (
              <article className="update-announcement" key={announcement.id}>
                <AnnouncementMetadata announcement={announcement} />
                <h3>{announcement.title}</h3>
                <p className="update-announcement__summary">{announcement.summary}</p>
                <AnnouncementSections announcement={announcement} />
              </article>
            ))}
          </div>
        </section>
      </div>

      <footer>
        <span>公告内容随源码版本发布，不连接远程更新服务</span>
        <span>最近公告 · {formatPublishedAt(LATEST_UPDATE_ANNOUNCEMENT.publishedAt)}</span>
      </footer>
    </>
  );
}
