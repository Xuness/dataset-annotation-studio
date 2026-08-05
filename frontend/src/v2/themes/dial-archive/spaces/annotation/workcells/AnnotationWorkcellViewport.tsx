import { useEffect, useRef } from "react";

import {
  type AnnotationConfirmation,
  type AnnotationCoverageLane,
  type AnnotationDossierContent,
  type AnnotationDossierSectionId,
  type AnnotationEditContent,
  type AnnotationProjectContextContent,
  type AnnotationProductionContent,
  type AnnotationRequestPreviewContent,
  type AnnotationStageAsset,
} from "../../../../../pages/spaces/spacePageModel";
import type { WorkcellTransitionState } from "../stage/hooks/useWorkcellTransition";
import { createStageWorkcellPlaneStyle } from "../stage/model/annotationStageLayout";
import { ANNOTATION_WORKCELL_PRESENTATION } from "../stage/model/annotationStagePresentation";
import { AnnotationEditWorkcell } from "./edit/AnnotationEditWorkcell";
import { AnnotationDossierWorkcell } from "./dossier/AnnotationDossierWorkcell";
import { AnnotationProductionWorkcell } from "./production/AnnotationProductionWorkcell";

interface AnnotationWorkcellViewportProps {
  transition: WorkcellTransitionState;
  asset: AnnotationStageAsset | null;
  channels: readonly AnnotationCoverageLane[];
  edit: AnnotationEditContent | null;
  projectContext: AnnotationProjectContextContent | null;
  requestPreview: AnnotationRequestPreviewContent | null;
  production: AnnotationProductionContent | null;
  dossier: AnnotationDossierContent | null;
  dossierSection: AnnotationDossierSectionId;
  confirmation: AnnotationConfirmation | null;
  onSelectDossierSection(section: AnnotationDossierSectionId): void;
  onResolveConfirmation(accepted: boolean): void;
}

export function AnnotationWorkcellViewport({
  transition,
  asset,
  channels,
  edit,
  projectContext,
  requestPreview,
  production,
  dossier,
  dossierSection,
  confirmation,
  onSelectDossierSection,
  onResolveConfirmation,
}: AnnotationWorkcellViewportProps) {
  const rootRef = useRef<HTMLElement>(null);
  const workcell = transition.displayedWorkcell;

  useEffect(() => {
    if (transition.phase === "active") rootRef.current?.focus({ preventScroll: true });
  }, [transition.phase, transition.version]);

  if (!workcell) return null;
  const presentation = ANNOTATION_WORKCELL_PRESENTATION[workcell];

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

        <div className="dial-archive-workcell-viewport__body">
          {workcell === "edit" ? (
            <AnnotationEditWorkcell asset={asset} channels={channels} edit={edit} />
          ) : workcell === "production" ? (
            <AnnotationProductionWorkcell
              asset={asset}
              production={production}
              projectContext={projectContext}
              requestPreview={requestPreview}
            />
          ) : (
            <AnnotationDossierWorkcell
              asset={asset}
              dossier={dossier}
              section={dossierSection}
              onSelectSection={onSelectDossierSection}
            />
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
