import type { CSSProperties } from "react";

import type {
  AnnotationCoverageLane,
  AnnotationSpaceContent,
} from "../../../../pages/spaces/spacePageModel";
import { ANNOTATION_LANE_PRESENTATION } from "./model/annotationPresentation";

interface AnnotationChannelMatrixProps {
  content: AnnotationSpaceContent;
}

interface SegmentStyle extends CSSProperties {
  "--annotation-segment-width": string;
}

function segmentStyle(value: number, total: number): SegmentStyle {
  return {
    "--annotation-segment-width": `${total > 0 ? (value / total) * 100 : 0}%`,
  };
}

function CoverageTrack({ lane, total }: { lane: AnnotationCoverageLane; total: number }) {
  return (
    <div
      className="dial-archive-annotation-channel__track"
      role="img"
      aria-label={`可用 ${lane.usableAssetCount}，过期 ${lane.staleAssetCount}，无效 ${lane.invalidAssetCount}，缺失 ${lane.missingAssetCount}`}
    >
      <i className="is-usable" style={segmentStyle(lane.usableAssetCount, total)} />
      <i className="is-stale" style={segmentStyle(lane.staleAssetCount, total)} />
      <i className="is-invalid" style={segmentStyle(lane.invalidAssetCount, total)} />
      <i className="is-missing" style={segmentStyle(lane.missingAssetCount, total)} />
    </div>
  );
}

export function AnnotationChannelMatrix({ content }: AnnotationChannelMatrixProps) {
  const total = content.project?.assetCount ?? 0;
  const available = content.status === "ready" && Boolean(content.project);
  const firstAssetId = content.samples[0]?.id;

  return (
    <section
      className="dial-archive-annotation-channels"
      aria-labelledby="annotation-channels-title"
    >
      <div className="dial-archive-space-frame">
        <header className="dial-archive-annotation-section-head">
          <div>
            <span>ANN / 02 — CHANNEL PRODUCTION MAP</span>
            <h2 id="annotation-channels-title">标注通道</h2>
          </div>
          <p>覆盖率只描述当前生产状态。人工编辑与自动执行从同一通道出发，但进入不同工作间。</p>
        </header>

        <div className="dial-archive-annotation-channel-list">
          {content.channels.map((lane, index) => {
            const presentation = ANNOTATION_LANE_PRESENTATION[lane.id];
            const variants =
              lane.id === "translation" ? content.translationVariants.slice(0, 4) : [];
            return (
              <article className={`dial-archive-annotation-channel is-${lane.id}`} key={lane.id}>
                <div className="dial-archive-annotation-channel__identity">
                  <span>{String(index + 1).padStart(2, "0")} / 03</span>
                  <b>{presentation.code}</b>
                  <em>{presentation.englishTitle}</em>
                </div>
                <div className="dial-archive-annotation-channel__body">
                  <header>
                    <div>
                      <h3>{presentation.title}</h3>
                      <p>{presentation.description}</p>
                    </div>
                    <strong>
                      {String(lane.coveragePercent).padStart(2, "0")}
                      <small>%</small>
                    </strong>
                  </header>
                  <CoverageTrack lane={lane} total={total} />
                  <dl>
                    <div>
                      <dt>USABLE</dt>
                      <dd>{lane.usableAssetCount}</dd>
                    </div>
                    <div>
                      <dt>STALE</dt>
                      <dd>{lane.staleAssetCount}</dd>
                    </div>
                    <div>
                      <dt>INVALID</dt>
                      <dd>{lane.invalidAssetCount}</dd>
                    </div>
                    <div>
                      <dt>MISSING</dt>
                      <dd>{lane.missingAssetCount}</dd>
                    </div>
                    <div>
                      <dt>DOCUMENTS</dt>
                      <dd>{lane.activeDocumentCount}</dd>
                    </div>
                  </dl>
                  {variants.length ? (
                    <div className="dial-archive-annotation-channel__variants">
                      <span>TRANSLATION IDENTITIES //</span>
                      {variants.map((variant) => (
                        <div key={variant.id}>
                          <b>{variant.displayName}</b>
                          <em>
                            {variant.language} · {variant.sourceKind.toUpperCase()} ·{" "}
                            {variant.producerKind.toUpperCase()}
                          </em>
                          <span>
                            {variant.usableAssetCount} / {total}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="dial-archive-annotation-channel__actions">
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => content.openWorkbench(firstAssetId, lane.id)}
                  >
                    <span>{presentation.manualAction}</span>
                    <em>MANUAL →</em>
                  </button>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => content.openProduction(lane.id)}
                  >
                    <span>{presentation.automaticAction}</span>
                    <em>AUTOMATIC →</em>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
