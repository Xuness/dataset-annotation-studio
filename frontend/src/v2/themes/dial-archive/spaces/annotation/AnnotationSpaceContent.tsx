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
