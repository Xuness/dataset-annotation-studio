import { useEffect, useState } from "react";

import type {
  CapabilitySystemSectionId,
  CapabilitySystemWorkbenchContent,
} from "../../../../pages/spaces/spacePageModel";

interface CapabilitySystemWorkbenchPageProps {
  content: CapabilitySystemWorkbenchContent;
}

const SYSTEM_SECTIONS: readonly {
  id: CapabilitySystemSectionId;
  code: string;
  label: string;
  englishLabel: string;
}[] = [
  { id: "appearance", code: "VIS", label: "界面外观", englishLabel: "Appearance" },
  { id: "announcements", code: "BLT", label: "更新公告", englishLabel: "Bulletins" },
  { id: "diagnostics", code: "DGN", label: "运行诊断", englishLabel: "Diagnostics" },
];

export function CapabilitySystemWorkbenchPage({ content }: CapabilitySystemWorkbenchPageProps) {
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState(
    content.announcements[0]?.id ?? null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedAnnouncement =
    content.announcements.find((item) => item.id === selectedAnnouncementId) ??
    content.announcements[0] ??
    null;
  const section = SYSTEM_SECTIONS.find((item) => item.id === content.sectionId)!;

  useEffect(() => {
    setFeedback(null);
    setActionError(null);
  }, [content.sectionId]);

  async function run(action: () => Promise<void>, message: string) {
    setFeedback(null);
    setActionError(null);
    try {
      await action();
      setFeedback(message);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Studio 控制操作失败。");
    }
  }

  return (
    <section
      className="dial-archive-capability-utility is-system"
      data-section={content.sectionId}
      data-status={content.status}
      aria-labelledby="capability-system-title"
    >
      <div className="dial-archive-capability-utility__grid" aria-hidden="true" />
      <header className="dial-archive-capability-utility__header">
        <button type="button" onClick={content.returnOverview}>
          <span aria-hidden="true">←</span>
          <small>SPACE 06 // PARENT</small>
          <strong>返回能力库</strong>
        </button>
        <div>
          <span>SPACE 06 // LEVEL 03 MODULE // SYS.CONTROL</span>
          <h1 id="capability-system-title">Studio 控制中心</h1>
          <p>外观、公告与诊断属于同一个次级控制面，不与四大生产能力并列。</p>
        </div>
        <div className="dial-archive-capability-system__signal">
          <span>CURRENT MODULE</span>
          <strong>
            {section.code} // {section.englishLabel.toUpperCase()}
          </strong>
        </div>
        <b>SYS</b>
      </header>

      <nav className="dial-archive-capability-system__tabs" aria-label="Studio 控制分区">
        <span>CONTROL CHANNEL //</span>
        {SYSTEM_SECTIONS.map((item, index) => (
          <button
            className={item.id === content.sectionId ? "is-active" : undefined}
            type="button"
            key={item.id}
            aria-current={item.id === content.sectionId ? "page" : undefined}
            onClick={() => content.selectSection(item.id)}
          >
            <small>{String(index + 1).padStart(2, "0")}</small>
            <b>{item.code}</b>
            <strong>{item.label}</strong>
            {item.id === "announcements" && content.hasUnreadAnnouncement ? (
              <i aria-label="有未读公告">NEW</i>
            ) : null}
          </button>
        ))}
        <p>{content.description}</p>
      </nav>

      <main className="dial-archive-capability-system__stage">
        {content.sectionId === "appearance" ? (
          <section className="dial-archive-capability-system__appearance">
            <div className="dial-archive-capability-system__appearance-hero">
              <span>CURRENT V2 APPEARANCE //</span>
              <h2>暖白经典管理界面</h2>
              <p>
                纸面暖白承担内容，碳黑建立结构，工业黄只标示焦点与状态。当前只展示真正生效的 V2
                外观契约。
              </p>
              <div aria-hidden="true">
                <i />
                <i />
                <i />
                <b>VIS</b>
              </div>
            </div>
            <dl>
              <div>
                <dt>ACTIVE THEME</dt>
                <dd>{content.appearance.themeId.toUpperCase()}</dd>
              </div>
              <div>
                <dt>PALETTE</dt>
                <dd>{content.appearance.palette}</dd>
              </div>
              <div>
                <dt>DESIGN BASELINE</dt>
                <dd>{content.appearance.baseline}</dd>
              </div>
              <div>
                <dt>PREFERENCE SCOPE</dt>
                <dd>{content.appearance.preferenceScope}</dd>
              </div>
            </dl>
            <aside>
              <span>MIGRATION NOTE</span>
              <strong>只迁移真实有效的偏好</strong>
              <p>
                旧主题的背景、透明度、模糊与沉浸字段，会在建立 V2 中立 Store
                后逐项接入；未接入字段不会伪装成开关。
              </p>
            </aside>
          </section>
        ) : content.sectionId === "announcements" ? (
          <section className="dial-archive-capability-system__bulletins">
            <aside>
              <header>
                <div>
                  <span>LOCAL RELEASE ARCHIVE //</span>
                  <strong>版本索引</strong>
                </div>
                <b>{content.hasUnreadAnnouncement ? "NEW" : "READ"}</b>
              </header>
              <nav aria-label="版本公告列表">
                {content.announcements.map((announcement, index) => (
                  <button
                    className={
                      announcement.id === selectedAnnouncement?.id ? "is-active" : undefined
                    }
                    type="button"
                    key={announcement.id}
                    onClick={() => setSelectedAnnouncementId(announcement.id)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>
                        {announcement.version} // {announcement.publishedAt}
                      </small>
                      <strong>{announcement.title}</strong>
                    </div>
                  </button>
                ))}
              </nav>
              <button
                className="dial-archive-capability-system__read"
                type="button"
                disabled={!content.hasUnreadAnnouncement}
                onClick={() => {
                  content.markLatestAnnouncementRead();
                  setFeedback("最新公告已标记为已读。");
                }}
              >
                标记最新公告已读 ✓
              </button>
            </aside>
            <article>
              <header>
                <span>
                  {selectedAnnouncement?.version ?? "—"} //{" "}
                  {selectedAnnouncement?.publishedAt ?? "—"}
                </span>
                <h2>{selectedAnnouncement?.title ?? "暂无公告"}</h2>
                <p>{selectedAnnouncement?.summary}</p>
              </header>
              <div>
                {selectedAnnouncement?.sections.map((announcementSection) => (
                  <section key={`${announcementSection.kind}-${announcementSection.title}`}>
                    <span>{announcementSection.kind.toUpperCase()}</span>
                    <h3>{announcementSection.title}</h3>
                    <ul>
                      {announcementSection.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </article>
          </section>
        ) : (
          <section className="dial-archive-capability-system__diagnostics">
            <header>
              <div>
                <span>SAFE DIAGNOSTIC RECORD //</span>
                <h2>本地运行状态</h2>
                <p>诊断摘要不包含 API Key、Prompt 正文或数据集内容。</p>
              </div>
              <b data-state={content.diagnostics.serviceStatus}>
                {content.diagnostics.serviceStatus}
              </b>
            </header>
            <div className="dial-archive-capability-system__diagnostic-status">
              <article>
                <span>FRONTEND</span>
                <strong>Dataset Studio {content.diagnostics.frontendVersion}</strong>
                <p>
                  {content.diagnostics.buildChannel} // {content.diagnostics.runtime}
                </p>
              </article>
              <article data-state={content.diagnostics.serviceStatus}>
                <span>LOCAL SERVICE</span>
                <strong>{content.diagnostics.serviceStatus}</strong>
                <p>BACKEND // {content.diagnostics.backendVersion}</p>
              </article>
            </div>
            <dl>
              <div>
                <dt>API ADDRESS</dt>
                <dd title={content.diagnostics.apiBaseUrl}>{content.diagnostics.apiBaseUrl}</dd>
              </div>
              <div>
                <dt>APP DATA</dt>
                <dd title={content.diagnostics.appDataDir}>{content.diagnostics.appDataDir}</dd>
              </div>
              <div>
                <dt>LOG DIRECTORY</dt>
                <dd title={content.diagnostics.logDir}>{content.diagnostics.logDir}</dd>
              </div>
            </dl>
            <footer>
              <button type="button" disabled={content.pending} onClick={content.refresh}>
                重新检测本地服务 ↻
              </button>
              <button
                type="button"
                disabled={!content.canOpenLogs}
                onClick={() => void run(content.openLogs, "已打开当前日志目录。")}
              >
                打开日志目录 ↗
              </button>
              <button
                type="button"
                onClick={() => void run(content.copyDiagnosticSummary, "脱敏诊断摘要已复制。")}
              >
                复制脱敏诊断摘要 ⧉
              </button>
            </footer>
          </section>
        )}
      </main>

      <footer className="dial-archive-capability-utility__footer">
        <span>SYS.{section.code} // STUDIO CONTROL</span>
        <span>SUBORDINATE MODULE</span>
        <b data-tone={actionError || content.message ? "error" : "ok"}>
          {actionError ?? content.message ?? feedback ?? "CONTROL READY"}
        </b>
      </footer>
    </section>
  );
}
