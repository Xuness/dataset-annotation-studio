import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  History,
  Megaphone,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  LATEST_UPDATE_ANNOUNCEMENT,
  UPDATE_ANNOUNCEMENTS,
  type UpdateAnnouncement,
  type UpdateAnnouncementSectionKind,
} from "../../../../src/features/updateAnnouncements/catalog";
import { useUpdateAnnouncementReadState } from "../../../../src/features/updateAnnouncements/readState";
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
    <div className="update-announcement-detail__sections">
      {announcement.sections.map((section) => {
        const Icon = SECTION_ICONS[section.kind];
        return (
          <section key={section.kind}>
            <div className="update-announcement-detail__section-heading">
              <span aria-hidden="true">
                <Icon size={15} />
              </span>
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

function AnnouncementListItem({
  announcement,
  selected,
  onSelect,
}: {
  announcement: UpdateAnnouncement;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "is-active" : ""}
      aria-pressed={selected}
      aria-label={`查看${announcement.title}`}
      onClick={onSelect}
    >
      <strong>{announcement.title}</strong>
      <small>
        {announcement.version} · {formatPublishedAt(announcement.publishedAt)}
      </small>
    </button>
  );
}

export function UpdateAnnouncementsSettings({ onClose }: { onClose: () => void }) {
  const markLatestAnnouncementRead = useUpdateAnnouncementReadState(
    (state) => state.markLatestAnnouncementRead,
  );
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState(
    LATEST_UPDATE_ANNOUNCEMENT.id,
  );
  const historicalAnnouncements = UPDATE_ANNOUNCEMENTS.slice(1);
  const selectedAnnouncement =
    UPDATE_ANNOUNCEMENTS.find((announcement) => announcement.id === selectedAnnouncementId) ??
    LATEST_UPDATE_ANNOUNCEMENT;
  const showingLatest = selectedAnnouncement.id === LATEST_UPDATE_ANNOUNCEMENT.id;

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
        <section className="update-announcement-list" aria-labelledby="announcement-list-title">
          <header>
            <div>
              <span className="eyebrow">Release index</span>
              <h3 id="announcement-list-title">公告版本</h3>
            </div>
            <small>{UPDATE_ANNOUNCEMENTS.length} 期</small>
          </header>

          <div className="update-announcement-list__groups">
            <section>
              <h4>本次更新</h4>
              <AnnouncementListItem
                announcement={LATEST_UPDATE_ANNOUNCEMENT}
                selected={showingLatest}
                onSelect={() => setSelectedAnnouncementId(LATEST_UPDATE_ANNOUNCEMENT.id)}
              />
            </section>

            <section>
              <h4>历史版本</h4>
              {historicalAnnouncements.map((announcement) => (
                <AnnouncementListItem
                  announcement={announcement}
                  selected={selectedAnnouncement.id === announcement.id}
                  onSelect={() => setSelectedAnnouncementId(announcement.id)}
                  key={announcement.id}
                />
              ))}
            </section>
          </div>
        </section>

        <article className="update-announcement-detail">
          <header>
            <div>
              <span className="eyebrow">{showingLatest ? "Latest release" : "Archive"}</span>
              <h3>{selectedAnnouncement.title}</h3>
              <p>{selectedAnnouncement.summary}</p>
            </div>
            <span className="update-announcement-detail__status">
              {showingLatest ? (
                <CheckCircle2 size={14} aria-hidden="true" />
              ) : (
                <History size={14} aria-hidden="true" />
              )}
              {showingLatest ? "已查看" : "历史公告"}
            </span>
          </header>

          <dl className="update-announcement-detail__metadata">
            <div>
              <dt>发布渠道</dt>
              <dd>源码预览版</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{selectedAnnouncement.version}</dd>
            </div>
            <div>
              <dt>发布日期</dt>
              <dd>
                <CalendarDays size={13} aria-hidden="true" />
                <time dateTime={selectedAnnouncement.publishedAt}>
                  {formatPublishedAt(selectedAnnouncement.publishedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>公告编号</dt>
              <dd title={selectedAnnouncement.id}>{selectedAnnouncement.id}</dd>
            </div>
          </dl>

          <div className="update-announcement-detail__heading">
            <span aria-hidden="true">
              <Megaphone size={16} />
            </span>
            <div>
              <span className="eyebrow">Changes</span>
              <h4>版本改动</h4>
            </div>
          </div>

          <AnnouncementSections announcement={selectedAnnouncement} />
        </article>
      </div>

      <footer>
        <span>公告内容随源码版本发布，不连接远程更新服务</span>
        <span>最近公告 · {formatPublishedAt(LATEST_UPDATE_ANNOUNCEMENT.publishedAt)}</span>
      </footer>
    </>
  );
}
