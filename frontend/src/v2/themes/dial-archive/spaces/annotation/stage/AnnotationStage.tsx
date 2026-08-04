import { useEffect, useRef, type KeyboardEventHandler } from "react";

import type { AnnotationStageContent } from "../../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { AnnotationFilmstrip } from "./AnnotationFilmstrip";
import { AnnotationSpecimen } from "./AnnotationSpecimen";
import { AnnotationStageCanvas } from "./AnnotationStageCanvas";
import { AnnotationStageReadout } from "./AnnotationStageReadout";
import { AnnotationWorkcellMap } from "./AnnotationWorkcellMap";
import { AnnotationWorkcellViewport } from "../workcells/AnnotationWorkcellViewport";
import { useStageAssetNavigation } from "./hooks/useStageAssetNavigation";
import { useStageCamera } from "./hooks/useStageCamera";
import { useStageParallax } from "./hooks/useStageParallax";
import { useWorkcellTransition } from "./hooks/useWorkcellTransition";
import { createAnnotationStageStyle } from "./model/annotationStageLayout";

/**
 * 三级素材施工场：冷白编辑画布（Z0）+ 展台与胶片轨道（Z1）+
 * 固定身份读数（Z2）。四级工作间作为本空间之上的展开态，画布不卸载。
 */

interface AnnotationStageProps {
  content: AnnotationStageContent;
}

export function AnnotationStage({ content }: AnnotationStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  useStageParallax(rootRef, reducedMotion);
  const camera = useStageCamera(rootRef, reducedMotion);
  const cancelCamera = camera.cancel;
  const navigation = useStageAssetNavigation(content, reducedMotion);
  const workcellTransition = useWorkcellTransition(content.activeWorkcell, reducedMotion);
  const displayedWorkcell = workcellTransition.displayedWorkcell;
  const workcellVisible = displayedWorkcell !== null;

  useEffect(() => {
    if (content.activeWorkcell) cancelCamera();
  }, [cancelCamera, content.activeWorkcell]);

  // 入场编舞只在首次装载数据时播放一次；走片与返回不得重播
  const enteredRef = useRef(false);
  const entering = content.status === "ready" && !enteredRef.current;
  useEffect(() => {
    if (content.status === "ready") enteredRef.current = true;
  }, [content.status]);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const editable =
      event.target instanceof Element &&
      Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"));
    if (editable) return;
    const insideWorkcell =
      event.target instanceof Element &&
      Boolean(event.target.closest("[data-stage-workcell-surface]"));
    if (event.key === "Escape" && workcellVisible) {
      event.preventDefault();
      content.closeWorkcell();
    } else if (insideWorkcell) {
      return;
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigation.stepAsset(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigation.stepAsset(-1);
    } else if (
      event.target === event.currentTarget &&
      event.key === "Enter" &&
      !workcellVisible &&
      navigation.visualAsset
    ) {
      event.preventDefault();
      content.openWorkcell("edit");
    } else if (
      event.target === event.currentTarget &&
      event.key === " " &&
      navigation.visualAsset
    ) {
      event.preventDefault();
      content.toggleAssetChecked(navigation.visualAsset.id);
    }
  };

  if (content.status === "no-context") {
    return (
      <section className="dial-archive-stage-state is-no-context">
        <div aria-hidden="true">// NO SOURCE</div>
        <span>CONTEXT REQUIRED // SPACE 03</span>
        <h1>素材施工场等待项目源</h1>
        <p>先在项目档案中装载一个本地工作目录，再进入标注生产。</p>
        <div>
          <button type="button" onClick={content.openArchive}>
            <b>进入项目档案</b>
            <em>OPEN ARCHIVE →</em>
          </button>
          <button type="button" onClick={content.returnToSpace}>
            返回标注生产空间
          </button>
        </div>
      </section>
    );
  }

  if (content.status === "loading") {
    return (
      <section className="dial-archive-stage-state is-loading" role="status">
        <div aria-hidden="true">03</div>
        <span>LOADING MATERIAL SEQUENCE</span>
        <h1>正在建立素材施工场</h1>
        <i aria-hidden="true" />
      </section>
    );
  }

  if (content.status === "error") {
    const canRetrySequence = Boolean(content.sequence.loadError && content.sequence.hasMore);
    return (
      <section className="dial-archive-stage-state is-error" role="alert">
        <div aria-hidden="true">// ATTENTION</div>
        <span>STAGE CONTEXT FAILURE</span>
        <h1>素材施工场无法装载</h1>
        <p>{content.message ?? "当前项目上下文不可用。"}</p>
        <div>
          {canRetrySequence ? (
            <button type="button" onClick={content.sequence.loadMore}>
              <b>重试素材序列</b>
              <em>RETRY SEQUENCE →</em>
            </button>
          ) : (
            <button type="button" onClick={content.openArchive}>
              返回项目档案
            </button>
          )}
          <button type="button" onClick={content.returnToSpace}>
            返回标注生产空间
          </button>
        </div>
      </section>
    );
  }

  const checkedSet = new Set(content.checkedAssetIds);
  const currentChecked = navigation.visualAsset ? checkedSet.has(navigation.visualAsset.id) : false;
  const walkClass = navigation.walk.active
    ? navigation.walk.direction > 0
      ? " is-walking-forward"
      : " is-walking-backward"
    : "";
  const workcellClass = displayedWorkcell
    ? ` has-workcell is-workcell-${displayedWorkcell} is-workcell-${workcellTransition.phase}`
    : "";

  return (
    <div
      className={`dial-archive-stage${entering && !reducedMotion ? " is-entering" : ""}${walkClass}${workcellClass}`}
      ref={rootRef}
      role="region"
      aria-label="素材施工场"
      tabIndex={0}
      style={createAnnotationStageStyle()}
      onKeyDown={handleKeyDown}
      onPointerDown={workcellVisible ? undefined : camera.onPointerDown}
      onPointerMove={workcellVisible ? undefined : camera.onPointerMove}
      onPointerUp={workcellVisible ? undefined : camera.onPointerUp}
      onPointerCancel={workcellVisible ? undefined : camera.onPointerCancel}
    >
      <AnnotationStageCanvas
        evidenceAssets={content.sequence.assets}
        currentIndex={navigation.visualIndex}
        checkedAssetIds={content.checkedAssetIds}
      />

      <header className="dial-archive-stage__masthead" data-stage-camera-lock>
        <button
          className="dial-archive-stage__return"
          type="button"
          onClick={workcellVisible ? content.closeWorkcell : content.returnToSpace}
        >
          <span aria-hidden="true">←</span>{" "}
          {workcellVisible ? "RETURN // STAGE OVERVIEW" : "RETURN // SPACE 03"}
        </button>
        <div className="dial-archive-stage__title">
          <em>
            {workcellVisible
              ? `WORKCELL // ${displayedWorkcell.toUpperCase()}`
              : "STAGE // MATERIAL YARD"}
          </em>
          <b>{workcellVisible ? "标注工作间" : "素材施工场"}</b>
        </div>
        <button className="dial-archive-stage__camera-reset" type="button" onClick={camera.reset}>
          <span>CAMERA</span>
          <b>RESET 0.0</b>
        </button>
        <div className="dial-archive-stage__project">
          <span>{content.project?.name ?? "—"}</span>
          <small>
            {content.sequence.totalCount} MATERIAL /{" "}
            {content.project ? content.project.annotatedCount : 0} ANNOTATED
          </small>
        </div>
      </header>

      <div className="dial-archive-stage__scene">
        <div className="dial-archive-stage__scene-camera">
          <AnnotationWorkcellMap
            asset={navigation.visualAsset}
            totalCount={content.sequence.totalCount}
            checkedCount={content.checkedAssetIds.length}
            channels={content.channels}
            operation={content.operation}
            focusedWorkcell={displayedWorkcell}
            onOpenWorkcell={content.openWorkcell}
          />
          <AnnotationSpecimen
            asset={navigation.visualAsset}
            checked={currentChecked}
            reducedMotion={reducedMotion}
            walk={navigation.walk}
            onOpenDefaultWorkcell={() => content.openWorkcell("edit")}
          />
          <AnnotationWorkcellViewport
            transition={workcellTransition}
            asset={navigation.visualAsset}
            totalCount={content.sequence.totalCount}
            checkedCount={content.checkedAssetIds.length}
            channels={content.channels}
            operation={content.operation}
            edit={content.edit}
            production={content.production}
            dossier={content.dossier}
            confirmation={content.confirmation}
            onClose={content.closeWorkcell}
            onSwitch={content.openWorkcell}
            onResolveConfirmation={content.resolveConfirmation}
          />
        </div>
        <AnnotationStageReadout
          asset={navigation.visualAsset}
          currentIndex={navigation.visualIndex}
          walk={navigation.walk}
        />
      </div>

      <AnnotationFilmstrip
        sequence={content.sequence}
        currentIndex={navigation.visualIndex}
        checkedAssetIds={content.checkedAssetIds}
        onSelectAsset={navigation.selectAsset}
        onStepAsset={navigation.stepAsset}
        onToggleAssetChecked={content.toggleAssetChecked}
      />

      {content.message ? (
        <div className="dial-archive-stage__message" role="alert">
          <span>STAGE ATTENTION //</span>
          <p>{content.message}</p>
        </div>
      ) : null}
    </div>
  );
}
