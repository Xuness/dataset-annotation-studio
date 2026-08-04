import { useEffect, useRef } from "react";

import {
  ANNOTATION_WORKCELL_IDS,
  type AnnotationConfirmation,
  type AnnotationCoverageLane,
  type AnnotationEditContent,
  type AnnotationLaneId,
  type AnnotationOperationSummary,
  type AnnotationStageAsset,
  type AnnotationWorkcellId,
} from "../../../../../pages/spaces/spacePageModel";
import type { WorkcellTransitionState } from "../stage/hooks/useWorkcellTransition";
import { createStageWorkcellPlaneStyle } from "../stage/model/annotationStageLayout";
import {
  ANNOTATION_WORKCELL_PRESENTATION,
  describeWorkcellStatus,
} from "../stage/model/annotationStagePresentation";
import { AnnotationEditWorkcell } from "./edit/AnnotationEditWorkcell";

interface AnnotationWorkcellViewportProps {
  transition: WorkcellTransitionState;
  asset: AnnotationStageAsset | null;
  totalCount: number;
  checkedCount: number;
  channels: readonly AnnotationCoverageLane[];
  operation: AnnotationOperationSummary | null;
  edit: AnnotationEditContent | null;
  activeProductionLane: AnnotationLaneId;
  confirmation: AnnotationConfirmation | null;
  onClose(): void;
  onSwitch(workcell: AnnotationWorkcellId): void;
  onResolveConfirmation(accepted: boolean): void;
}

export function AnnotationWorkcellViewport({
  transition,
  asset,
  totalCount,
  checkedCount,
  channels,
  operation,
  edit,
  activeProductionLane,
  confirmation,
  onClose,
  onSwitch,
  onResolveConfirmation,
}: AnnotationWorkcellViewportProps) {
  const rootRef = useRef<HTMLElement>(null);
  const workcell = transition.displayedWorkcell;

  useEffect(() => {
    if (transition.phase === "active") rootRef.current?.focus({ preventScroll: true });
  }, [transition.phase, transition.version]);

  if (!workcell) return null;
  const presentation = ANNOTATION_WORKCELL_PRESENTATION[workcell];
  const status = describeWorkcellStatus(
    workcell,
    asset,
    checkedCount,
    totalCount,
    channels,
    operation,
  );
  const pendingLane = workcell === "production" ? activeProductionLane.toUpperCase() : null;

  return (
    <section
      className={`dial-archive-workcell-viewport is-${workcell} is-${transition.phase}`}
      style={createStageWorkcellPlaneStyle(workcell)}
      ref={rootRef}
      tabIndex={-1}
      aria-label={`${presentation.title}工作间`}
      aria-hidden={transition.phase === "closing" || undefined}
      data-stage-camera-lock
      data-stage-workcell-surface
    >
      {transition.departingWorkcell ? (
        <div
          className={`dial-archive-workcell-viewport__departing is-${transition.departingWorkcell}`}
          style={createStageWorkcellPlaneStyle(transition.departingWorkcell)}
          aria-hidden="true"
        >
          <b>{ANNOTATION_WORKCELL_PRESENTATION[transition.departingWorkcell].englishTitle}</b>
        </div>
      ) : null}

      <div className="dial-archive-workcell-viewport__plane" key={workcell}>
        <i className="dial-archive-workcell-viewport__rear is-register" aria-hidden="true" />
        <i className="dial-archive-workcell-viewport__rear is-signal" aria-hidden="true" />

        <header className="dial-archive-workcell-viewport__header">
          <div className="dial-archive-workcell-viewport__identity">
            <span>ACCESS VECTOR // {presentation.code}</span>
            <b>{presentation.englishTitle}</b>
            <em>{presentation.title}</em>
          </div>

          <nav className="dial-archive-workcell-viewport__switcher" aria-label="切换工作间">
            {ANNOTATION_WORKCELL_IDS.map((candidate) => {
              const candidatePresentation = ANNOTATION_WORKCELL_PRESENTATION[candidate];
              const active = candidate === workcell;
              return (
                <button
                  className={active ? "is-active" : undefined}
                  type="button"
                  aria-label={`切换到${candidatePresentation.title}工作间`}
                  aria-pressed={active}
                  onClick={() => onSwitch(candidate)}
                  key={candidate}
                >
                  <span>{candidatePresentation.code}</span>
                  <b>{candidatePresentation.englishTitle}</b>
                </button>
              );
            })}
          </nav>

          <div className="dial-archive-workcell-viewport__status">
            {status.live ? <i aria-hidden="true" /> : null}
            <span>{status.label}</span>
          </div>
          <button
            className="dial-archive-workcell-viewport__close"
            type="button"
            aria-label="返回素材施工场总览"
            onClick={onClose}
          >
            <span>RETURN</span>
            <b>STAGE OVERVIEW</b>
            <i aria-hidden="true">×</i>
          </button>
        </header>

        <div className="dial-archive-workcell-viewport__body">
          {workcell === "edit" ? (
            <AnnotationEditWorkcell
              asset={asset}
              channels={channels}
              checkedCount={checkedCount}
              edit={edit}
            />
          ) : (
            <div className="dial-archive-workcell-viewport__pending" role="status">
              <span>
                {presentation.code} // STRUCTURE RESERVED{pendingLane ? ` // ${pendingLane}` : ""}
              </span>
              <h2>{presentation.title}工作间</h2>
              <p>{presentation.description}</p>
              <b>本轮保留空间入口与切换关系，功能构图将在对应工作间设计时接入。</b>
            </div>
          )}
        </div>

        {confirmation ? (
          <div
            className={`dial-archive-workcell-confirmation is-${confirmation.tone}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="annotation-workcell-confirmation-title"
            aria-describedby="annotation-workcell-confirmation-message"
          >
            <button
              className="dial-archive-workcell-confirmation__scrim"
              type="button"
              aria-label={confirmation.cancelLabel}
              onClick={() => onResolveConfirmation(false)}
            />
            <section>
              <span>INTERRUPT // UNSAVED OBJECT</span>
              <h2 id="annotation-workcell-confirmation-title">{confirmation.title}</h2>
              <p id="annotation-workcell-confirmation-message">{confirmation.message}</p>
              <div>
                <button type="button" onClick={() => onResolveConfirmation(false)}>
                  {confirmation.cancelLabel}
                </button>
                <button type="button" onClick={() => onResolveConfirmation(true)} autoFocus>
                  {confirmation.confirmLabel}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
