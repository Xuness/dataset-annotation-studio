import type { QualitySpaceContent as QualitySpaceContentModel } from "../../../../pages/spaces/spacePageModel";
import { QualityEvidenceLanes } from "./QualityEvidenceLanes";
import { QualityGate } from "./QualityGate";
import { QualityHandoff } from "./QualityHandoff";

interface QualitySpaceContentProps {
  content: QualitySpaceContentModel;
}

export function QualitySpaceContent({ content }: QualitySpaceContentProps) {
  return (
    <article className="dial-archive-quality-page" aria-label="质量控制空间">
      <QualityGate content={content} />
      <QualityEvidenceLanes content={content} />
      <QualityHandoff content={content} />
    </article>
  );
}
