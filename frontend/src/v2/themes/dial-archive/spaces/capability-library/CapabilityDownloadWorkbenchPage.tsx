import { useEffect, useState } from "react";

import type { CapabilityDownloadWorkbenchContent } from "../../../../pages/spaces/spacePageModel";

interface CapabilityDownloadWorkbenchPageProps {
  content: CapabilityDownloadWorkbenchContent;
}

export function CapabilityDownloadWorkbenchPage({ content }: CapabilityDownloadWorkbenchPageProps) {
  const [selectedOfferId, setSelectedOfferId] = useState(content.offers[0]?.id ?? null);
  const [confirmOfferId, setConfirmOfferId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedOffer =
    content.offers.find((offer) => offer.id === selectedOfferId) ?? content.offers[0] ?? null;

  useEffect(() => {
    if (!selectedOfferId || !content.offers.some((offer) => offer.id === selectedOfferId)) {
      setSelectedOfferId(content.offers[0]?.id ?? null);
    }
  }, [content.offers, selectedOfferId]);

  useEffect(() => {
    setConfirmOfferId(null);
  }, [selectedOfferId]);

  async function run(action: () => Promise<void>, message: string) {
    setFeedback(null);
    setActionError(null);
    try {
      await action();
      setFeedback(message);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "下载操作失败，请稍后重试。");
    }
  }

  return (
    <section
      className="dial-archive-capability-utility is-download"
      data-category={content.categoryId}
      data-status={content.status}
      aria-labelledby="capability-download-title"
    >
      <div className="dial-archive-capability-utility__grid" aria-hidden="true" />
      <header className="dial-archive-capability-utility__header">
        <button type="button" onClick={content.returnCategory}>
          <span aria-hidden="true">←</span>
          <small>{content.code} // PARENT</small>
          <strong>返回{content.code}资源页</strong>
        </button>
        <div>
          <span>SPACE 06 // {content.code}.DLQ</span>
          <h1 id="capability-download-title">{content.label}</h1>
          <p>{content.description}</p>
        </div>
        <button
          className="dial-archive-capability-utility__refresh"
          type="button"
          disabled={content.pending}
          onClick={content.refresh}
        >
          <span>SYNC</span>
          <strong>刷新目录与任务</strong>
          <i aria-hidden="true">↻</i>
        </button>
        <b>DLQ</b>
      </header>

      <div className="dial-archive-capability-download">
        <aside className="dial-archive-capability-download__catalog">
          <header>
            <div>
              <span>AVAILABLE CATALOG //</span>
              <strong>可用资源</strong>
            </div>
            <b>{String(content.offers.length).padStart(2, "0")}</b>
          </header>
          <div>
            {content.offers.map((offer, index) => (
              <button
                className={offer.id === selectedOffer?.id ? "is-active" : undefined}
                type="button"
                key={offer.id}
                data-state={offer.state}
                aria-current={offer.id === selectedOffer?.id ? "true" : undefined}
                onClick={() => setSelectedOfferId(offer.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{offer.state.toUpperCase()}</small>
                  <strong>{offer.label}</strong>
                  <em>{offer.detail}</em>
                </div>
                <i aria-hidden="true" />
              </button>
            ))}
            {!content.offers.length ? (
              <div className="dial-archive-capability-utility__empty" role="status">
                <strong>
                  {content.status === "loading" ? "SYNCING CATALOG" : "NO DOWNLOAD OFFER"}
                </strong>
                <span>{content.message ?? "当前来源未返回可下载项目。"}</span>
              </div>
            ) : null}
          </div>
          <footer>
            <span>CATALOG SOURCE</span>
            <strong>{content.englishLabel.toUpperCase()}</strong>
          </footer>
        </aside>

        <main className="dial-archive-capability-download__stage">
          <section className="dial-archive-capability-download__offer">
            <header>
              <div>
                <span>SELECTED OFFER // {content.code}</span>
                <small>{selectedOffer?.sourceLabel ?? "NO SOURCE"}</small>
              </div>
              <b>{selectedOffer?.state.toUpperCase() ?? "EMPTY"}</b>
            </header>
            <div className="dial-archive-capability-download__offer-body">
              <div>
                <span>{content.englishLabel.toUpperCase()}</span>
                <h2>{selectedOffer?.label ?? "等待下载目录"}</h2>
                <p>{selectedOffer?.description ?? content.description}</p>
              </div>
              {selectedOffer ? (
                <dl>
                  <div>
                    <dt>SOURCE</dt>
                    <dd>{selectedOffer.sourceLabel}</dd>
                  </div>
                  <div>
                    <dt>REVISION</dt>
                    <dd>{selectedOffer.revision}</dd>
                  </div>
                  <div>
                    <dt>VOLUME</dt>
                    <dd>{selectedOffer.size}</dd>
                  </div>
                  <div>
                    <dt>LICENSE</dt>
                    <dd>{selectedOffer.licenseLabel}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
            <footer>
              <div>
                <span>LICENSE GATE</span>
                <strong>{selectedOffer?.licenseLabel ?? "等待目录"}</strong>
                <small>下载前请确认来源与授权要求</small>
              </div>
              <button
                type="button"
                disabled={!selectedOffer}
                onClick={() => selectedOffer && void content.openLicense(selectedOffer.id)}
              >
                授权页面 ↗
              </button>
              <button
                type="button"
                disabled={!selectedOffer}
                onClick={() => selectedOffer && void content.openSource(selectedOffer.id)}
              >
                资源来源 ↗
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={!selectedOffer?.canStart || content.pending}
                onClick={() => {
                  if (!selectedOffer) return;
                  if (confirmOfferId !== selectedOffer.id) {
                    setConfirmOfferId(selectedOffer.id);
                    return;
                  }
                  setConfirmOfferId(null);
                  void run(() => content.startOffer(selectedOffer.id), "下载任务已进入队列。");
                }}
              >
                {confirmOfferId === selectedOffer?.id ? "再次确认并下载 ↓" : "确认授权后下载 ↓"}
              </button>
            </footer>
          </section>

          <section className="dial-archive-capability-download__tasks" aria-label="下载任务队列">
            <header>
              <div>
                <span>RECOVERABLE TASK QUEUE //</span>
                <h2>下载任务</h2>
              </div>
              <b>{String(content.tasks.length).padStart(2, "0")}</b>
            </header>
            <div>
              {content.tasks.map((task) => (
                <article key={task.id} data-status={task.status}>
                  <header>
                    <div>
                      <span>{task.status.toUpperCase()}</span>
                      <strong>{task.label}</strong>
                      <small>{task.detail}</small>
                    </div>
                    <b>{String(task.progress).padStart(3, "0")}%</b>
                  </header>
                  <div className="dial-archive-capability-download__progress" aria-hidden="true">
                    <i style={{ width: `${task.progress}%` }} />
                  </div>
                  <p>{task.error ?? task.currentFile ?? task.transferred}</p>
                  <footer>
                    <button
                      type="button"
                      disabled={!task.canPause || content.pending}
                      onClick={() => void run(() => content.pauseTask(task.id), "下载任务已暂停。")}
                    >
                      PAUSE
                    </button>
                    <button
                      type="button"
                      disabled={!task.canResume || content.pending}
                      onClick={() =>
                        void run(() => content.resumeTask(task.id), "下载任务已继续。")
                      }
                    >
                      RESUME
                    </button>
                    <button
                      type="button"
                      disabled={!task.canRemove || content.pending}
                      onClick={() =>
                        void run(() => content.removeTask(task.id), "下载任务已移除。")
                      }
                    >
                      REMOVE
                    </button>
                  </footer>
                </article>
              ))}
              {!content.tasks.length ? (
                <div className="dial-archive-capability-utility__empty is-compact">
                  <strong>QUEUE STANDBY</strong>
                  <span>当前没有下载任务。</span>
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      <footer className="dial-archive-capability-utility__footer">
        <span>{content.code}.DLQ // DOWNLOAD CENTER</span>
        <span>RESTART RESUMABLE</span>
        <b>{actionError ?? content.message ?? feedback ?? "CATALOG READY"}</b>
      </footer>
    </section>
  );
}
