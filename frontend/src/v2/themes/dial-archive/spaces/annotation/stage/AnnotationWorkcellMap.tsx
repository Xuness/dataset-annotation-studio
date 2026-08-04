import { memo } from "react";

import {
  ANNOTATION_WORKCELL_IDS,
  type AnnotationCoverageLane,
  type AnnotationOperationSummary,
  type AnnotationStageAsset,
  type AnnotationWorkcellId,
} from "../../../../../pages/spaces/spacePageModel";
import { formatStageByteSize, formatStageIndex } from "./model/annotationStageLayout";
import {
  ANNOTATION_WORKCELL_PRESENTATION,
  describeWorkcellStatus,
  readAssetChannelStates,
} from "./model/annotationStagePresentation";

/**
 * 右列控制台：巨型序号读数、序列分页器、真实元数据与工作间卡片深度栈。
 * 三张卡片以 z 深度错开悬浮；hover/focus 预览前移，点击直接展开工作间。
 */

interface AnnotationWorkcellMapProps {
  asset: AnnotationStageAsset | null;
  currentIndex: number;
  totalCount: number;
  checkedCount: number;
  channels: readonly AnnotationCoverageLane[];
  operation: AnnotationOperationSummary | null;
  focusedWorkcell: AnnotationWorkcellId | null;
  onStepAsset(offset: number): void;
  onOpenWorkcell(workcell: AnnotationWorkcellId): void;
}

export const AnnotationWorkcellMap = memo(function AnnotationWorkcellMap({
  asset,
  currentIndex,
  totalCount,
  checkedCount,
  channels,
  operation,
  focusedWorkcell,
  onStepAsset,
  onOpenWorkcell,
}: AnnotationWorkcellMapProps) {
  const channelReadings = readAssetChannelStates(asset);
  const progressSlots = 6;
  const progressFilled =
    totalCount > 0 && currentIndex >= 0
      ? Math.min(progressSlots, Math.floor(((currentIndex + 1) / totalCount) * progressSlots) + 1)
      : 0;

  return (
    <aside className="dial-archive-stage-console" aria-label="施工场控制台">
      <header className="dial-archive-stage-console__readout">
        <div className="dial-archive-stage-console__ordinal" aria-hidden="true">
          {formatStageIndex(currentIndex)}
        </div>
        <p className="dial-archive-stage-console__filename" title={asset?.filename}>
          {asset?.filename ?? "NO MATERIAL LOADED"}
        </p>
      </header>

      <div className="dial-archive-stage-console__pager" role="group" aria-label="素材序列导航">
        <button
          type="button"
          aria-label="上一张素材"
          disabled={currentIndex <= 0}
          onClick={() => onStepAsset(-1)}
        >
          ‹
        </button>
        <output>
          <em>{currentIndex >= 0 ? currentIndex + 1 : "—"}</em>
          <span> / {totalCount || "—"}</span>
        </output>
        <button
          type="button"
          aria-label="下一张素材"
          disabled={totalCount === 0 || currentIndex >= totalCount - 1}
          onClick={() => onStepAsset(1)}
        >
          ›
        </button>
      </div>
      <div className="dial-archive-stage-console__progress" aria-hidden="true">
        {Array.from({ length: progressSlots }, (_, index) => (
          <i className={index < progressFilled ? "is-filled" : undefined} key={index} />
        ))}
      </div>

      <dl className="dial-archive-stage-console__meta">
        <dt>FORMAT</dt>
        <dd>{asset ? asset.suffix.replace(".", "").toUpperCase() : "—"}</dd>
        <dt>SIZE</dt>
        <dd>{asset ? formatStageByteSize(asset.byteSize) : "—"}</dd>
        <dt>CHANNELS</dt>
        <dd className="dial-archive-stage-console__channels">
          {channelReadings.map((reading) => (
            <em className={`is-${reading.state}`} key={reading.lane}>
              {reading.code}.{reading.stateCode}
            </em>
          ))}
        </dd>
      </dl>

      <div className="dial-archive-stage-console__stack" role="group" aria-label="工作间入口">
        {ANNOTATION_WORKCELL_IDS.map((workcell, depth) => {
          const presentation = ANNOTATION_WORKCELL_PRESENTATION[workcell];
          const status = describeWorkcellStatus(
            workcell,
            asset,
            checkedCount,
            totalCount,
            channels,
            operation,
          );
          const focused = focusedWorkcell === workcell;
          return (
            <button
              className={`dial-archive-stage-workcell is-${workcell}${focused ? " is-focused" : ""}${status.live ? " is-live" : ""}`}
              type="button"
              aria-label={`${presentation.action} ${presentation.title}`}
              style={{ "--dial-archive-workcell-depth": depth } as React.CSSProperties}
              onClick={() => onOpenWorkcell(workcell)}
              key={workcell}
            >
              <span className="dial-archive-stage-workcell__signal" aria-hidden="true" />
              <span className="dial-archive-stage-workcell__head">
                <em>{presentation.code}</em>
                <b>{presentation.englishTitle}</b>
              </span>
              <span className="dial-archive-stage-workcell__title">{presentation.title}</span>
              <span className="dial-archive-stage-workcell__status">
                {status.live ? <i aria-hidden="true" /> : null}
                {status.label}
              </span>
              <span className="dial-archive-stage-workcell__action" aria-hidden="true">
                {presentation.action} →
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
});
