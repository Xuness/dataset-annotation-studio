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
            查看待审查角色任务{" "}
          </button>
        </section>
      )}
    </article>
  );
}
