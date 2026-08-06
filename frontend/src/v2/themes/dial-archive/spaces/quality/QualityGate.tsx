import { useEffect, useRef, type UIEventHandler } from "react";

import {
  QUALITY_CHANNEL_PRESENTATION,
  type QualitySpaceContent,
} from "../../../../pages/spaces/spacePageModel";

interface QualityGateProps {
  content: QualitySpaceContent;
}

export function QualityGate({ content }: QualityGateProps) {
  const filmTrackRef = useRef<HTMLDivElement>(null);
  const asset = content.focusAsset;
  const project = content.project;
  const queueIndex = Math.max(
    0,
    content.queues.findIndex((candidate) => candidate.id === content.filter),
  );
  const queue = content.queues[queueIndex];
  const previousQueue =
    content.queues[(queueIndex - 1 + content.queues.length) % content.queues.length];
  const nextQueue = content.queues[(queueIndex + 1) % content.queues.length];
  const ready = content.status === "ready" && Boolean(project);
  const previousAsset = content.samples[Math.max(0, content.focusIndex - 1)];
  const nextAsset = content.samples[Math.min(content.samples.length - 1, content.focusIndex + 1)];
  const filmSlots = Array.from({ length: Math.max(6, content.samples.length) }, (_, index) => ({
    asset: content.samples[index],
    index,
  }));

  useEffect(() => {
    const track = filmTrackRef.current;
    const current = track?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!track || !current) return;

    const top = current.offsetTop;
    const bottom = top + current.offsetHeight;
    const visibleTop = track.scrollTop;
    const visibleBottom = visibleTop + track.clientHeight;
    if (top >= visibleTop + 8 && bottom <= visibleBottom - 8) return;

    const target = Math.max(0, top - (track.clientHeight - current.offsetHeight) / 2);
    if (typeof track.scrollTo === "function") track.scrollTo({ top: target, behavior: "smooth" });
    else track.scrollTop = target;
  }, [asset?.id]);

  const handleFilmScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const track = event.currentTarget;
    const remaining = track.scrollHeight - track.scrollTop - track.clientHeight;
    if (remaining < 180 && content.hasMore && !content.fetchingMore) content.loadMore();
  };

  return (
    <section className="dial-archive-quality-field" aria-labelledby="quality-title">
      <div className="dial-archive-space-frame">
        <header className="dial-archive-quality-field__heading" data-dial-archive-entry>
          <div>
            <span>↘ QUALITY CONTROL</span>
            <h1 id="quality-title">质量控制</h1>
          </div>
          <div className="dial-archive-quality-field__ghost" aria-hidden="true">
            VERIFY<span>FIELD</span>
          </div>
          <p>对象不是在这里被展示，而是在证据、版本与人工判定之间接受一次可追溯的筛查。</p>
        </header>

        <div className="dial-archive-quality-field__console" data-dial-archive-entry>
          <aside className="dial-archive-quality-film" aria-label="素材胶片轨道">
            <header className="dial-archive-quality-film__head">
              <strong>04</strong>
              <span>
                <em>QAC</em>
                <b>FILM TRACE</b>
              </span>
            </header>

            <div className="dial-archive-quality-film__window">
              <span className="dial-archive-quality-film__perforation is-left" aria-hidden="true" />
              <div
                className="dial-archive-quality-film__track"
                ref={filmTrackRef}
                role="region"
                aria-label="可滚动素材序列"
                aria-busy={content.fetchingMore}
                onScroll={handleFilmScroll}
              >
                {filmSlots.map((slot) => {
                  const sample = slot.asset;
                  const active = sample?.id === asset?.id;
                  return (
                    <button
                      className={active ? "is-active" : undefined}
                      type="button"
                      disabled={!sample || !ready}
                      aria-current={active ? "true" : undefined}
                      aria-label={
                        sample ? `定位素材 ${sample.filename}` : `空胶片位 ${slot.index + 1}`
                      }
                      onClick={() => sample && content.selectAsset(sample.id)}
                      key={sample?.id ?? `film-empty-${slot.index}`}
                    >
                      {sample ? (
                        <img
                          src={sample.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      ) : (
                        <i aria-hidden="true" />
                      )}
                      <span>{String(slot.index + 1).padStart(3, "0")}</span>
                      <em>{active ? "CURRENT" : sample ? "READY" : "EMPTY"}</em>
                    </button>
                  );
                })}
              </div>
              <span
                className="dial-archive-quality-film__perforation is-right"
                aria-hidden="true"
              />
            </div>

            <footer className="dial-archive-quality-film__foot">
              <span className="dial-archive-quality-film__project" title={project?.rootPath}>
                <em>PROJECT //</em>
                <b>{project?.name ?? "NO SOURCE"}</b>
              </span>
              <span className={`dial-archive-quality-film__signal is-${content.status}`}>
                <i aria-hidden="true" />
                {ready ? "FIELD READY" : content.status.toUpperCase()}
              </span>
              <div className="dial-archive-quality-film__nav">
                <button
                  type="button"
                  aria-label="上一个筛查对象"
                  disabled={!previousAsset || previousAsset.id === asset?.id}
                  onClick={() => previousAsset && content.selectAsset(previousAsset.id)}
                >
                  ‹
                </button>
                <span>
                  {String(Math.max(0, content.focusIndex + 1)).padStart(3, "0")} /{" "}
                  {String(content.totalCount).padStart(3, "0")}
                </span>
                <button
                  type="button"
                  aria-label="下一个筛查对象"
                  disabled={!nextAsset || nextAsset.id === asset?.id}
                  onClick={() => nextAsset && content.selectAsset(nextAsset.id)}
                >
                  ›
                </button>
              </div>
            </footer>
          </aside>

          <div className="dial-archive-quality-scope">
            <span className="dial-archive-quality-scope__rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <button
              className={`dial-archive-quality-scope__specimen${asset ? " is-loaded" : ""}`}
              type="button"
              disabled={!asset || !ready}
              aria-label={asset ? `进入复核对象 ${asset.filename}` : "当前闸门没有待检查对象"}
              onClick={() => content.openReview(asset?.id)}
            >
              {asset ? (
                <img key={asset.id} src={asset.imageUrl} alt={asset.filename} draggable={false} />
              ) : (
                <span className="dial-archive-quality-scope__empty">
                  <b>{content.status === "loading" ? "READING EVIDENCE" : "NO OBJECT SIGNAL"}</b>
                  <em>{queue?.label ?? "QUALITY GATE"}</em>
                </span>
              )}
            </button>
            <span className="dial-archive-quality-scope__mode" aria-hidden="true">
              <b>EVIDENCE VIEW</b>
              <em>RAW / SOURCE</em>
            </span>
            <div className="dial-archive-quality-scope__caption">
              <span>
                <em>SOURCE OBJECT //</em>
                <b>{asset?.filename ?? "UNRESOLVED"}</b>
              </span>
              <span>
                {asset ? `${asset.width} × ${asset.height}` : "—"}
                <br />
                {asset?.annotationStatus.toUpperCase() ?? "NO SIGNAL"}
              </span>
            </div>
          </div>

          <aside className="dial-archive-quality-field__decision" aria-label="当前质量闸门">
            <span>ACTIVE GATE // {String(queueIndex + 1).padStart(2, "0")}</span>
            <strong>{String(queue?.count ?? 0).padStart(2, "0")}</strong>
            <small>OBJECTS IN FIELD</small>

            <div className="dial-archive-quality-field__selector">
              <button
                type="button"
                aria-label={`切换至 ${previousQueue?.label ?? "上一队列"}`}
                onClick={() => previousQueue && content.selectFilter(previousQueue.id)}
              >
                ‹
              </button>
              <span>
                <em>
                  {String(queueIndex + 1)} / {content.queues.length}
                </em>
                <b>{queue?.label ?? "待判定"}</b>
              </span>
              <button
                type="button"
                aria-label={`切换至 ${nextQueue?.label ?? "下一队列"}`}
                onClick={() => nextQueue && content.selectFilter(nextQueue.id)}
              >
                ›
              </button>
            </div>

            <div className="dial-archive-quality-field__ticks" aria-hidden="true">
              {content.queues.map((candidate) => (
                <i
                  className={candidate.id === content.filter ? "is-active" : undefined}
                  key={candidate.id}
                />
              ))}
            </div>
            <p>{queue?.description ?? "等待质量队列完成定位。"}</p>

            <nav className="dial-archive-quality-field__channels" aria-label="当前证据通道">
              {content.channels.map((lane) => {
                const active = lane.id === content.channel;
                return (
                  <button
                    className={active ? "is-active" : undefined}
                    type="button"
                    aria-pressed={active}
                    onClick={() => content.selectChannel(lane.id)}
                    key={lane.id}
                  >
                    <span>{QUALITY_CHANNEL_PRESENTATION[lane.id].code}</span>
                    <b>{QUALITY_CHANNEL_PRESENTATION[lane.id].label}</b>
                    <em>{lane.coveragePercent}%</em>
                  </button>
                );
              })}
            </nav>

            {project ? (
              <div className="dial-archive-quality-field__actions">
                <button
                  className="is-primary"
                  type="button"
                  disabled={!ready}
                  onClick={content.openDelivery}
                >
                  <span>
                    <b>继续至 05 导出</b>
                    <small>复核可跳过，保留当前状态</small>
                  </span>
                  <em>CONTINUE 05 →</em>
                </button>
                <button
                  type="button"
                  disabled={!ready || !asset}
                  onClick={() => content.openReview(asset?.id)}
                >
                  <span>
                    <b>进入证据复核台</b>
                    <small>可选：逐项确认当前证据</small>
                  </span>
                  <em>OPTIONAL CHECK →</em>
                </button>
                <button
                  className="is-tertiary"
                  type="button"
                  disabled={!ready || !asset}
                  onClick={() => content.openAnnotation(asset?.id)}
                >
                  返回 03 修订
                </button>
              </div>
            ) : (
              <button
                className="dial-archive-quality-field__archive"
                type="button"
                onClick={content.openArchive}
              >
                装载项目源 →
              </button>
            )}
            {content.message ? <p className="is-message">{content.message}</p> : null}
          </aside>
        </div>

        <footer className="dial-archive-quality-field__baseline">
          <span>CALIBRATED OBJECT FIELD</span>
          <i />
          <span>QUEUE ROUTES BELOW</span>
        </footer>
      </div>
    </section>
  );
}
