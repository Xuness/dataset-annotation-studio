import type { PreparationSpaceContent as PreparationSpaceContentModel } from "../../../../pages/spaces/spacePageModel";
import { DialArchiveBarcode } from "../../components/DialArchivePrimitives";
import { PreparationCapabilityField } from "./PreparationCapabilityField";
import { PreparationHero } from "./PreparationHero";
import { PreparationOperationStrip } from "./PreparationOperationStrip";

interface PreparationSpaceContentProps {
  content: PreparationSpaceContentModel;
}

export function PreparationSpaceContent({ content }: PreparationSpaceContentProps) {
  return (
    <article className="dial-archive-preparation-page" aria-label="数据整备空间">
      <PreparationHero content={content} />
      <PreparationCapabilityField content={content} />
      <PreparationOperationStrip content={content} />
      <footer className="dial-archive-space-footer dial-archive-space-frame">
        <span>SPACE 02 // PREPARATION — DISPATCH FIELD</span>
        <span>
          SCROLL DOCUMENT
          <DialArchiveBarcode className="dial-archive-space-footer__barcode" />
          THEME.R2
        </span>
      </footer>
    </article>
  );
}
