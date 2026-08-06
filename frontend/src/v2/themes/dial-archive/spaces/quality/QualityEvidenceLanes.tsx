import type { CSSProperties } from "react";

import {
  QUALITY_CHANNEL_PRESENTATION,
  type QualitySpaceContent,
} from "../../../../pages/spaces/spacePageModel";

interface QualityEvidenceLanesProps {
  content: QualitySpaceContent;
}

interface QueueRouteStyle extends CSSProperties {
  "--quality-route-start": string;
  "--quality-route-span": string;
}

const QUEUE_GEOMETRY = [
  [0, 62],
  [28, 66],
  [8, 70],
  [42, 54],
  [18, 72],
  [4, 58],
  [34, 62],
] as const;

export function QualityEvidenceLanes({ content }: QualityEvidenceLanesProps) {
  return (
    <section className="dial-archive-quality-log" aria-labelledby="quality-lanes-title">
      <div className="dial-archive-space-frame">
        <header className="dial-archive-quality-log__head">
          <span>04 / QUALITY ROUTING</span>
          <h2 id="quality-lanes-title">
            EVIDENCE <i>LOG</i>
          </h2>
          <p>状态不是七个孤立的盒子，而是七条可以切换、回溯并继续向前延伸的检查路线。</p>
        </header>

        <nav className="dial-archive-quality-route-map" aria-label="质量状态路线">
          {content.queues.map((queue, index) => {
            const active = queue.id === content.filter;
            const [start, span] = QUEUE_GEOMETRY[index];
            return (
              <button
                className={`${active ? "is-active" : ""} is-${queue.tone}`}
                style={
                  {
                    "--quality-route-start": `${start}%`,
                    "--quality-route-span": `${span}%`,
                  } as QueueRouteStyle
                }
                type="button"
                aria-pressed={active}
                onClick={() => content.selectFilter(queue.id)}
                key={queue.id}
              >
                <span className="dial-archive-quality-route-map__label">
                  <em>{String(index + 1).padStart(2, "0")}</em>
                  <b>{queue.label}</b>
                  <small>{queue.code}</small>
                </span>
                <span className="dial-archive-quality-route-map__rail">
                  <i aria-hidden="true" />
                  <b>{String(queue.count).padStart(2, "0")}</b>
                  <em>{queue.description}</em>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="dial-archive-quality-log__divider">
          <span>CHANNEL EVIDENCE //</span>
          <i />
          <span>{content.project?.name ?? "NO PROJECT"}</span>
        </div>

        <div className="dial-archive-quality-log__channels">
          {content.channels.map((lane, index) => {
            const presentation = QUALITY_CHANNEL_PRESENTATION[lane.id];
            const active = lane.id === content.channel;
            return (
              <button
                className={active ? "is-active" : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => content.selectChannel(lane.id)}
                key={lane.id}
              >
                <span>
                  <em>0{index + 1}</em>
                  <b>{presentation.code}</b>
                </span>
                <span>
                  <b>{presentation.label}</b>
                  <em>{presentation.description}</em>
                </span>
                <span aria-hidden="true">
                  <i style={{ width: `${lane.coveragePercent}%` }} />
                </span>
                <span>
                  <b>{lane.coveragePercent}%</b>
                  <em>
                    {lane.usableAssetCount} CURRENT · {lane.staleAssetCount} STALE ·{" "}
                    {lane.invalidAssetCount} INVALID
                  </em>
                </span>
              </button>
            );
          })}
        </div>

        {content.translationVariants.length ? (
          <div className="dial-archive-quality-log__translations">
            <span>TRANSLATION IDENTITIES //</span>
            {content.translationVariants.slice(0, 5).map((variant) => (
              <button
                type="button"
                onClick={() => content.openReview(content.focusAsset?.id, "translation")}
                key={variant.id}
              >
                <b>{variant.displayName}</b>
                <em>
                  {variant.language.toUpperCase()} · {variant.sourceKind.toUpperCase()} ·{" "}
                  {variant.producerKind.toUpperCase()}
                </em>
                <span>{variant.usableAssetCount} CURRENT</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
