import type { AnnotationSpaceContent as AnnotationSpaceContentModel } from "../../../../pages/spaces/spacePageModel";
import { DialArchiveBarcode } from "../../components/DialArchivePrimitives";
import { AnnotationChannelMatrix } from "./AnnotationChannelMatrix";
import { AnnotationHero } from "./AnnotationHero";
import { AnnotationProductionSignal } from "./AnnotationProductionSignal";

interface AnnotationSpaceContentProps {
  content: AnnotationSpaceContentModel;
}

export function AnnotationSpaceContent({ content }: AnnotationSpaceContentProps) {
  return (
    <article className="dial-archive-annotation-page" aria-label="标注生产空间">
      <AnnotationHero content={content} />
      <AnnotationChannelMatrix content={content} />
      <AnnotationProductionSignal content={content} />
      {content.openCharacterAudits && (
        <section className="dial-archive-character-entry dial-archive-space-frame">
          <div>
            <strong>角色标签审查</strong>
            <p>汇总标签、参考图证据与多人冲突裁决，不替代整份 Tags 复核。</p>
          </div>
          <button
            type="button"
            data-testid="open-character-audits"
            onClick={content.openCharacterAudits}
          >
            {" "}
            创建角色审查工作流{" "}
          </button>
        </section>
      )}
      <footer className="dial-archive-space-footer dial-archive-space-frame">
        <span>SPACE 03 // ANNOTATION — OBJECT PRODUCTION</span>
        <span>
          SCROLL DOCUMENT
          <DialArchiveBarcode className="dial-archive-space-footer__barcode" />
          THEME.R2
        </span>
      </footer>
    </article>
  );
}
