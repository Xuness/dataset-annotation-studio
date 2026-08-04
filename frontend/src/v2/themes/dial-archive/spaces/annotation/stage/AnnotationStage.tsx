import { useEffect, useRef, type KeyboardEventHandler } from "react";

import type { AnnotationStageContent } from "../../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { AnnotationFilmstrip } from "./AnnotationFilmstrip";
import { AnnotationSpecimen } from "./AnnotationSpecimen";
import { AnnotationStageCanvas } from "./AnnotationStageCanvas";
import { AnnotationWorkcellMap } from "./AnnotationWorkcellMap";
import { useStageParallax } from "./hooks/useStageParallax";

/**
 * 三级素材施工场：暗色星空画布（Z0）+ 展台与胶片轨道（Z1）+
 * 控制台读数（Z2）。四级工作间作为本空间之上的展开态，画布不卸载。
 */

interface AnnotationStageProps {
  content: AnnotationStageContent;
}

export function AnnotationStage({ content }: AnnotationStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  useStageParallax(rootRef, reducedMotion);

  // 入场编舞只在首次装载数据时播放一次；走片与返回不得重播
  const enteredRef = useRef(false);
  const entering = content.status === "ready" && !enteredRef.current;
  useEffect(() => {
    if (content.status === "ready") enteredRef.current = true;
  }, [content.status]);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      content.stepAsset(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      content.stepAsset(-1);
    } else if (event.key === "Enter" && content.currentAsset) {
      event.preventDefault();
      content.openWorkcell("edit");
    } else if (event.key === " " && content.currentAsset) {
      event.preventDefault();
      content.toggleAssetChecked(content.currentAsset.id);
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
    return (
      <section className="dial-archive-stage-state is-error" role="alert">
        <div aria-hidden="true">// ATTENTION</div>
        <span>STAGE CONTEXT FAILURE</span>
        <h1>素材施工场无法装载</h1>
        <p>{content.message ?? "当前项目上下文不可用。"}</p>
        <div>
          <button type="button" onClick={content.openArchive}>
            返回项目档案
          </button>
          <button type="button" onClick={content.returnToSpace}>
            返回标注生产空间
          </button>
        </div>
      </section>
    );
  }

  const checkedSet = new Set(content.checkedAssetIds);
  const currentChecked = content.currentAsset ? checkedSet.has(content.currentAsset.id) : false;

  return (
    <div
      className={`dial-archive-stage${entering && !reducedMotion ? " is-entering" : ""}`}
      ref={rootRef}
      role="region"
      aria-label="素材施工场"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <AnnotationStageCanvas evidenceAssets={content.sequence.assets} />

      <header className="dial-archive-stage__masthead">
        <button
          className="dial-archive-stage__return"
          type="button"
          onClick={content.returnToSpace}
        >
          <span aria-hidden="true">←</span> RETURN // SPACE 03
        </button>
        <div className="dial-archive-stage__title">
          <em>STAGE // MATERIAL YARD</em>
          <b>素材施工场</b>
        </div>
        <div className="dial-archive-stage__project">
          <span>{content.project?.name ?? "—"}</span>
          <small>
            {content.sequence.totalCount} MATERIAL /{" "}
            {content.project ? content.project.annotatedCount : 0} ANNOTATED
          </small>
        </div>
      </header>

      <div className="dial-archive-stage__floor">
        <AnnotationSpecimen
          asset={content.currentAsset}
          checked={currentChecked}
          onOpenDefaultWorkcell={() => content.openWorkcell("edit")}
        />
        <AnnotationWorkcellMap
          asset={content.currentAsset}
          currentIndex={content.currentIndex}
          totalCount={content.sequence.totalCount}
          checkedCount={content.checkedAssetIds.length}
          channels={content.channels}
          operation={content.operation}
          focusedWorkcell={content.initialWorkcell}
          onStepAsset={content.stepAsset}
          onOpenWorkcell={content.openWorkcell}
        />
      </div>

      <AnnotationFilmstrip
        sequence={content.sequence}
        currentIndex={content.currentIndex}
        checkedAssetIds={content.checkedAssetIds}
        onSelectAsset={content.selectAsset}
        onStepAsset={content.stepAsset}
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
