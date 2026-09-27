import type { CharacterAuditContent } from "../../../../pages/spaces/spacePageModel";

import { CharacterConflict } from "./CharacterConflict";

interface Props {
  content: CharacterAuditContent;
}
export function CharacterApply({ content: c }: Props) {
  const plan = c.preview;
  return (
    <section className="dial-archive-character-section" data-testid="character-apply-section">
      <header>
        <span>04 / CHANGE PLAN</span>
        <h2>先裁决冲突，再应用差异</h2>
      </header>
      <p>所有修改只创建数据库 Tags 修订，不写 TXT，不自动标记整份 Tags 已人工复核。</p>
      <button
        type="button"
        data-testid="character-generate-preview"
        disabled={c.busy || c.dirty || c.operation?.status !== "review"}
        onClick={() => void c.generatePreview()}
      >
        校验输入版本并生成预览
      </button>
      {plan && (
        <>
          <p>
            尚未人工确认的角色：
            {c.operation?.reviews.filter((review) => !review.confirmed).length ?? 0}
          </p>
          <p data-testid="character-preview-count">
            将修改 {plan.changed_count} 张 · 共享图片 {plan.membership.shared_count} 张 · 未归属{" "}
            {plan.membership.unattributed_count} 张保持不变
          </p>
          {plan.conflicts.map((conflict, index) => (
            <CharacterConflict
              key={`${conflict.asset_id}:${conflict.tag}`}
              content={c}
              conflict={conflict}
              index={index}
            />
          ))}
          <div className="dial-archive-character-diffs">
            {plan.changes.map((change) => (
              <details key={change.asset_id}>
                <summary>{change.relative_path}</summary>
                <p>
                  <b>修改前</b> {change.before.map((tag) => tag.name).join(", ")}
                </p>
                <p>
                  <b>修改后</b> {change.after.map((tag) => tag.name).join(", ")}
                </p>
              </details>
            ))}
          </div>
          <button
            type="button"
            data-testid="character-apply"
            disabled={
              c.busy ||
              c.operation?.reviews.some((review) => !review.confirmed) ||
              plan.conflicts.some((item) => !item.resolution)
            }
            onClick={() => void c.apply()}
          >
            确认应用 · {plan.changed_count} 张
          </button>
        </>
      )}
    </section>
  );
}
