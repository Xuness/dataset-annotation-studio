import { useEffect, useRef, type KeyboardEventHandler } from "react";

import {
  ANNOTATION_LANE_IDS,
  QUALITY_CHANNEL_PRESENTATION,
  type QualityReviewContent,
} from "../../../../pages/spaces/spacePageModel";

interface QualityReviewStageProps {
  content: QualityReviewContent;
}

function availabilityLabel(status: string | undefined): string {
  if (status === "usable") return "CURRENT";
  if (status === "stale") return "STALE";
  if (status === "invalid") return "INVALID";
  return "MISSING";
}

function reviewLabel(status: string | null | undefined): string {
  return status === "reviewed" ? "REVIEWED" : "OPEN";
}

export function QualityReviewStage({ content }: QualityReviewStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const asset = content.currentAsset;
  const document = content.activeDocument;
  const queueCode =
    content.queues.find((candidate) => candidate.id === content.filter)?.code ?? "REVIEW";
  const queueCount =
    content.queues.find((candidate) => candidate.id === content.filter)?.count ?? 0;
  const windowStart = Math.max(
    0,
    Math.min(content.currentIndex - 3, Math.max(0, content.sequence.assets.length - 7)),
  );
  const sequenceWindow = content.sequence.assets.slice(windowStart, windowStart + 7);

  useEffect(() => rootRef.current?.focus(), []);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const editable =
      event.target instanceof Element &&
      Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"));
    if (editable) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      content.stepAsset(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      content.stepAsset(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      content.returnToQuality();
    }
  };

  if (content.status === "no-context") {
    return (
      <section className="dial-archive-quality-review-state is-no-context">
        <div aria-hidden="true">// NO SOURCE</div>
        <span>CONTEXT REQUIRED // SPACE 04</span>
        <h1>证据复核台等待项目源</h1>
        <p>先在项目档案中装载一个工作目录，再进入质量判定。</p>
        <div>
          <button type="button" onClick={content.openArchive}>
            进入项目档案
          </button>
          <button type="button" onClick={content.returnToQuality}>
            返回质量控制
          </button>
        </div>
      </section>
    );
  }

  if (content.status === "loading") {
    return (
      <section className="dial-archive-quality-review-state is-loading" role="status">
        <div aria-hidden="true">04</div>
        <span>ASSEMBLING EVIDENCE</span>
        <h1>正在建立证据复核台</h1>
        <i aria-hidden="true" />
      </section>
    );
  }

  if (content.status === "error") {
    return (
      <section className="dial-archive-quality-review-state is-error" role="alert">
        <div aria-hidden="true">// ATTENTION</div>
        <span>QUALITY CONTEXT FAILURE</span>
        <h1>证据复核台无法装载</h1>
        <p>{content.message ?? "当前项目证据不可用。"}</p>
        <div>
          <button type="button" onClick={content.returnToQuality}>
            返回质量控制
          </button>
          <button type="button" onClick={content.openArchive}>
            打开项目档案
          </button>
        </div>
      </section>
    );
  }

  return (
    <div
      className="dial-archive-quality-review"
      ref={rootRef}
      role="region"
      aria-label="证据复核台"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="dial-archive-quality-review__masthead">
        <button type="button" onClick={content.returnToQuality}>
          ← RETURN // QUALITY GATE
        </button>
        <div>
          <em>04 / REVIEW DESK</em>
          <b>证据复核台</b>
        </div>
        <span>
          {queueCode} · {content.sequence.totalCount} OBJECTS
        </span>
        <span>
          {content.project?.name ?? "—"}
          <small>{asset?.relativePath ?? "NO OBJECT"}</small>
        </span>
      </header>

      <main className="dial-archive-quality-review__body">
        <section className="dial-archive-quality-review__specimen" aria-label="当前检查对象">
          <div className="dial-archive-quality-review__image">
            {asset ? <img src={asset.imageUrl} alt={asset.filename} draggable={false} /> : null}
            <span className="dial-archive-quality-review__reticle" aria-hidden="true" />
            <span className="dial-archive-quality-review__orbit" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="dial-archive-quality-review__image-code" aria-hidden="true">
              04
            </span>
            <div className="dial-archive-quality-review__image-readout">
              <span>
                <em>OBJECT // {String(content.currentIndex + 1).padStart(3, "0")}</em>
                <b>{asset?.filename ?? "NO OBJECT"}</b>
              </span>
              <span>
                {asset?.width ?? 0} × {asset?.height ?? 0}
                <br />
                TRUE COLOR EVIDENCE
              </span>
            </div>
          </div>
          <div className="dial-archive-quality-review__image-axis" aria-hidden="true">
            <i />
            <span>VISUAL SOURCE</span>
            <b>LOCKED</b>
          </div>
          <div className="dial-archive-quality-review__coordinates" aria-hidden="true">
            <span>X {String(asset?.width ?? 0).padStart(4, "0")}</span>
            <span>Y {String(asset?.height ?? 0).padStart(4, "0")}</span>
            <span>Z 01.000</span>
          </div>
        </section>

        <aside className="dial-archive-quality-review__ledger" aria-label="当前通道证据">
          <header>
            <span>EVIDENCE LEDGER //</span>
            <b>{document?.displayName ?? QUALITY_CHANNEL_PRESENTATION[content.channel].label}</b>
            <em>{QUALITY_CHANNEL_PRESENTATION[content.channel].code}</em>
          </header>

          <nav aria-label="切换证据通道">
            {ANNOTATION_LANE_IDS.map((channel) => {
              const active = channel === content.channel;
              const channelDocument = content.documents.find(
                (candidate) => candidate.channel === channel,
              );
              return (
                <button
                  className={active ? "is-active" : undefined}
                  type="button"
                  aria-pressed={active}
                  onClick={() => content.selectChannel(channel)}
                  key={channel}
                >
                  <span>{QUALITY_CHANNEL_PRESENTATION[channel].code}</span>
                  <b>{QUALITY_CHANNEL_PRESENTATION[channel].label}</b>
                  <i className={`is-${channelDocument?.availabilityStatus ?? "missing"}`} />
                </button>
              );
            })}
          </nav>

          <dl className="dial-archive-quality-review__status">
            <div>
              <dt>AVAILABILITY //</dt>
              <dd className={`is-${document?.availabilityStatus ?? "missing"}`}>
                {availabilityLabel(document?.availabilityStatus)}
              </dd>
            </div>
            <div>
              <dt>REVIEW //</dt>
              <dd>{reviewLabel(document?.reviewStatus)}</dd>
            </div>
            <div>
              <dt>VALIDATION //</dt>
              <dd>{(document?.validationStatus ?? "UNKNOWN").toUpperCase()}</dd>
            </div>
            <div>
              <dt>SOURCE //</dt>
              <dd>{document?.sourceLabel ?? "—"}</dd>
            </div>
            {document?.sourceDetail ? (
              <div>
                <dt>IDENTITY //</dt>
                <dd>{document.sourceDetail.toUpperCase()}</dd>
              </div>
            ) : null}
            <div>
              <dt>REVISION //</dt>
              <dd title={document?.headRevisionId ?? undefined}>
                {document?.headRevisionId?.slice(0, 12) ?? "—"}
              </dd>
            </div>
          </dl>

          <section className="dial-archive-quality-review__content" aria-label="证据内容">
            <header>
              <span>CONTENT EVIDENCE //</span>
              <em>
                {document?.contentKind === "tags"
                  ? `${document.tags.length} TERMS`
                  : `${document?.content.length ?? 0} CHARS`}
              </em>
            </header>
            {document?.contentKind === "tags" && document.tags.length ? (
              <div className="dial-archive-quality-review__tags">
                {document.tags.map((tag, index) => (
                  <span key={`${tag.name}-${index}`}>
                    <b>{tag.name}</b>
                    <em>{tag.category ?? "general"}</em>
                    {tag.confidence !== null ? <i>{Math.round(tag.confidence * 100)}%</i> : null}
                  </span>
                ))}
              </div>
            ) : document?.content ? (
              <p>{document.content}</p>
            ) : (
              <div className="dial-archive-quality-review__empty">NO CHANNEL EVIDENCE</div>
            )}
          </section>

          {document?.validationIssues.length ? (
            <div className="dial-archive-quality-review__issues">
              <span>VALIDATION NOTES //</span>
              {document.validationIssues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          ) : null}

          <div className="dial-archive-quality-review__actions">
            <button
              className="is-primary"
              type="button"
              disabled={!document?.canReview || content.reviewPending}
              onClick={() => void content.reviewCurrent()}
            >
              <span>
                <b>
                  {content.reviewPending
                    ? "正在写入判定"
                    : document?.reviewStatus === "reviewed"
                      ? "当前版本已复核"
                      : "确认当前证据"}
                </b>
                <small>只判定当前对象、当前通道与当前版本</small>
              </span>
              <em>{content.reviewPending ? "COMMITTING" : "VERIFY →"}</em>
            </button>
            <button type="button" onClick={content.openAnnotation}>
              <span>
                <b>返回 03 修订</b>
                <small>对象与通道保持不变</small>
              </span>
              <em>REPAIR →</em>
            </button>
          </div>
          {content.actionMessage ? (
            <p className="dial-archive-quality-review__message" role="status">
              {content.actionMessage}
            </p>
          ) : null}
          <div className="dial-archive-quality-review__ledger-mark" aria-hidden="true">
            <span>VERDICT</span>
            <b>04</b>
            <em>
              {queueCode} / {String(queueCount).padStart(2, "0")}
            </em>
          </div>
        </aside>
      </main>

      <footer className="dial-archive-quality-review__filmstrip">
        <button type="button" aria-label="上一个复核对象" onClick={() => content.stepAsset(-1)}>
          ←
        </button>
        <div>
          {sequenceWindow.map((candidate, index) => (
            <button
              className={candidate.id === asset?.id ? "is-active" : undefined}
              type="button"
              aria-label={`选择复核对象 ${candidate.filename}`}
              onClick={() => content.selectAsset(candidate.id)}
              key={candidate.id}
            >
              <img src={candidate.thumbnailUrl} alt="" draggable={false} />
              <span>{String(windowStart + index + 1).padStart(3, "0")}</span>
            </button>
          ))}
        </div>
        <button type="button" aria-label="下一个复核对象" onClick={() => content.stepAsset(1)}>
          →
        </button>
        <span>
          {String(content.currentIndex + 1).padStart(3, "0")} /{" "}
          {String(content.sequence.totalCount).padStart(3, "0")}
        </span>
      </footer>
    </div>
  );
}
