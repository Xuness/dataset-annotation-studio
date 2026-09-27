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
      <div className="legacy-character-review-layout">
        <aside className="legacy-character-specimen">
          {c.referenceUrl && <img src={c.referenceUrl} alt={`${profile.trigger} 的审查参考图`} />}
          <strong>
            {profile.trigger} · {review?.confirmed ? "已人工确认" : "待人工确认"}
          </strong>
          <p>{review?.completed_stages.join(" → ") || "尚未执行"}</p>
          {review?.prompt && (
            <>
              <textarea
                data-testid="character-prompt"
                readOnly
                value={review.prompt}
                aria-label="角色提示词"
                rows={5}
              />
              <Button
                type="button"
                data-testid="character-copy-prompt"
                disabled={c.busy}
                onClick={() => void c.copyPrompt()}
              >
                复制角色提示词
              </Button>
            </>
          )}
          <p>角色提示词只保留已确认特征，不会覆盖逐图标签。</p>
        </aside>
        <div className="legacy-character-decisions">
          {review && (
            <details>
              <summary>未达到频次的标签 · {review.excluded.length} 项，保持原样</summary>
              <p>
                {review.excluded.map((item) => `${item.tag} (${item.count})`).join("，") || "无"}
              </p>
            </details>
          )}
          <div className="legacy-character-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>标签 / 类别 / 簇</th>
                  <th>初筛 → 视觉建议</th>
                  <th>最终决定</th>
                  <th>证据 / 替换目标</th>
                  <th>角色提示词</th>
                </tr>
              </thead>
              <tbody>
                {c.decisions.map((item, index) => {
                  const inventory = review?.inventory.find((entry) => entry.tag === item.tag);
                  const initial = review?.initial.find((entry) => entry.tag === item.tag);
                  const suggested = review?.suggested.find((entry) => entry.tag === item.tag);
                  const editable = op.status === "review" && !c.busy;
                  return (
                    <tr
                      key={item.tag}
                      data-cluster={
                        inventory?.cluster === null ? "none" : (inventory?.cluster ?? 0) % 3
                      }
                    >
                      <td>
                        <strong>{item.tag}</strong>
                        <small>
                          {inventory?.count} 张 · {item.category}
                        </small>
                        {inventory?.cluster != null && (
                          <small>关联簇 #{inventory.cluster} · 需要视觉核对</small>
                        )}
                      </td>
                      <td>
                        {initial ? DECISION_LABELS[initial.decision] : "—"} →{" "}
                        {suggested ? DECISION_LABELS[suggested.decision] : "—"}
                        <small>{suggested?.reason}</small>
                      </td>
                      <td>
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
                      </td>
                      <td>
                        {item.decision === "replace" && (
                          <input
                            aria-label={`${item.tag} 的替换词`}
                            data-testid={`character-replacement-${index}`}
                            disabled={!editable}
                            value={item.replacement ?? ""}
                            onChange={(e) => update(index, { replacement: e.target.value })}
                          />
                        )}
                        <textarea
                          aria-label={`${item.tag} 的证据`}
                          data-testid={`character-reason-${index}`}
                          disabled={!editable}
                          value={item.reason}
                          onChange={(e) => update(index, { reason: e.target.value })}
                          rows={2}
                        />
                      </td>
                      <td>
                        <label className="legacy-character-check">
                          <input
                            data-testid={`character-include-${index}`}
                            type="checkbox"
                            disabled={
                              !editable ||
                              item.decision === "delete" ||
                              item.decision === "uncertain"
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
