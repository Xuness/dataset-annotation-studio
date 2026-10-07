import { Button } from "../../shared/ui/Button";
import type {
  CharacterAuditContent,
  CharacterAuditDecision,
} from "../../../src/application/characterAudits/characterAuditModel";
import {
  CHARACTER_DECISION_LABELS as DECISION_LABELS,
  CHARACTER_DECISIONS as DECISIONS,
  CHARACTER_APPEARANCE_CATEGORIES as MUTABLE,
} from "../../../src/application/characterAudits/characterAuditModel";
interface Props {
  content: CharacterAuditContent;
}
export function CharacterReview({ content: c }: Props) {
  const op = c.operation;
  if (!op) return null;
  const review = op.reviews[c.profileIndex];
  const profile = op.request.profiles[c.profileIndex];
  function update(index: number, next: Partial<CharacterAuditDecision>) {
    c.updateDecision(index, { ...c.decisions[index], ...next });
  }
  return (
    <section
      className="legacy-character-section"
      data-surface-region="content"
      data-testid="character-review"
    >
      <header>
        <span className="eyebrow">人工审阅</span>
        <h2>逐角色核对证据</h2>
      </header>
      <nav className="legacy-character-tabs" aria-label="审查角色">
        {op.request.profiles.map((p, index) => (
          <Button
            type="button"
            data-testid={`character-review-tab-${index}`}
            key={p.trigger}
            aria-pressed={index === c.profileIndex}
            disabled={c.busy}
            onClick={() => c.selectProfile(index)}
          >
            {p.trigger}
          </Button>
        ))}
      </nav>
      <div className="character-review-content">
        <div className="character-review-summary">
          <small>固定参考图：{op.references[c.profileIndex]?.relative_path}</small>
          <strong>
            {profile.trigger} · {review?.confirmed ? "已人工确认" : "待人工确认"}
          </strong>
          <p>{review?.completed_stages.join(" → ") || "尚未执行"}</p>
          {review?.prompt && (
            <details>
              <summary data-testid="character-prompt-expand">角色提示词</summary>
              <textarea
                data-testid="character-prompt"
                readOnly
                value={review.prompt}
                aria-label="角色提示词"
                rows={3}
              />
              <Button
                type="button"
                data-testid="character-copy-prompt"
                disabled={c.busy}
                onClick={() => void c.copyPrompt()}
              >
                复制角色提示词
              </Button>
            </details>
          )}
          <p>角色提示词只保留已确认特征，不会覆盖逐图标签。</p>
        </div>
        <div className="legacy-character-decisions">
          {review && (
            <details>
              <summary>未达到频次的标签 · {review.excluded.length} 项，保持原样</summary>
              <p>
                {review.excluded.map((item) => `${item.tag} (${item.count})`).join("，") || "无"}
              </p>
            </details>
          )}
          <div className="character-decision-list">
            {c.decisions.map((item, index) => {
              const inventory = review?.inventory.find((entry) => entry.tag === item.tag);
              const initial = review?.initial.find((entry) => entry.tag === item.tag);
              const suggested = review?.suggested.find((entry) => entry.tag === item.tag);
              const editable = op.status === "review" && !c.busy;
              return (
                <article
                  className="character-decision-row"
                  key={item.tag}
                  data-cluster={
                    inventory?.cluster === null ? "none" : (inventory?.cluster ?? 0) % 3
                  }
                >
                  <div className="character-decision-field">
                    <strong>{item.tag}</strong>
                    <small>
                      {inventory?.count} 张 · {item.category}
                    </small>
                    {inventory?.cluster != null && (
                      <small>关联簇 #{inventory.cluster} · 需要视觉核对</small>
                    )}
                  </div>
                  <div className="character-decision-field">
                    {initial ? DECISION_LABELS[initial.decision] : "—"} →{" "}
                    {suggested ? DECISION_LABELS[suggested.decision] : "—"}
                    <small>{suggested?.reason}</small>
                  </div>
                  <div className="character-decision-field">
                    <select
                      aria-label={`${item.tag} 的决定`}
                      data-testid={`character-decision-${index}`}
                      disabled={!editable}
                      value={item.decision}
                      onChange={(e) => {
                        const decision = DECISIONS.find((value) => value === e.target.value);
                        if (decision)
                          update(index, {
                            decision,
                            replacement: decision === "replace" ? "" : null,
                            include_in_prompt:
                              decision === "delete" || decision === "uncertain"
                                ? false
                                : item.include_in_prompt,
                          });
                      }}
                    >
                      {DECISIONS.map((decision) => (
                        <option
                          key={decision}
                          value={decision}
                          disabled={
                            !MUTABLE.has(item.category) &&
                            decision !== "keep" &&
                            decision !== "uncertain"
                          }
                        >
                          {DECISION_LABELS[decision]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="character-decision-field">
                    {item.decision === "replace" && (
                      <input
                        aria-label={`${item.tag} 的替换词`}
                        data-testid={`character-replacement-${index}`}
                        disabled={!editable}
                        value={item.replacement ?? ""}
                        onChange={(e) => update(index, { replacement: e.target.value })}
                      />
                    )}
                    <details className="character-decision-evidence">
                      <summary data-testid={`character-evidence-${index}`}>证据与理由</summary>
                      <textarea
                        aria-label={`${item.tag} 的证据`}
                        data-testid={`character-reason-${index}`}
                        disabled={!editable}
                        value={item.reason}
                        onChange={(e) => update(index, { reason: e.target.value })}
                        rows={3}
                      />
                    </details>
                  </div>
                  <div className="character-decision-field">
                    <label className="legacy-character-check">
                      <input
                        data-testid={`character-include-${index}`}
                        type="checkbox"
                        disabled={
                          !editable || item.decision === "delete" || item.decision === "uncertain"
                        }
                        checked={item.include_in_prompt}
                        onChange={(e) => update(index, { include_in_prompt: e.target.checked })}
                      />
                      收录
                    </label>
                    <input
                      type="number"
                      min={0}
                      aria-label={`${item.tag} 的提示词顺序`}
                      data-testid={`character-order-${index}`}
                      disabled={!editable}
                      value={item.prompt_order}
                      onChange={(e) => update(index, { prompt_order: Number(e.target.value) })}
                    />
                  </div>
                </article>
              );
            })}
          </div>
          {op.status === "review" && (
            <div className="legacy-character-actions">
              <Button
                type="button"
                tone="primary"
                data-testid="character-save-review"
                disabled={c.busy}
                onClick={() => void c.saveReview()}
              >
                {c.dirty ? "保存人工修改" : "确认此角色决定"}
              </Button>
              <Button
                type="button"
                data-testid="character-use-suggestions"
                disabled={c.busy}
                onClick={c.useSuggestions}
              >
                采用当前视觉建议
              </Button>
              <Button
                type="button"
                data-testid="character-redo-visual"
                disabled={c.busy || c.dirty}
                onClick={() => void c.redoVisual()}
              >
                仅重新视觉审查此角色
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
