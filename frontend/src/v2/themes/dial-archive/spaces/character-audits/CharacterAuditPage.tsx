import type { CharacterAuditContent } from "../../../../pages/spaces/spacePageModel";

import {
  CHARACTER_AUDIT_STATUS,
  ACTIVE_CHARACTER_AUDIT_STATUSES as ACTIVE,
} from "../../../../pages/spaces/spacePageModel";
import { CharacterConfiguration } from "./CharacterConfiguration";
import { CharacterReview } from "./CharacterReview";
import { CharacterApply } from "./CharacterApply";

interface Props {
  content: CharacterAuditContent;
}

export function CharacterAuditPage({ content: c }: Props) {
  const op = c.operation;
  return (
    <article className="dial-archive-character-page" aria-label="角色标签审查工作台">
      <header className="dial-archive-character-masthead">
        <div>
          <span>ANN / CHARACTER EVIDENCE</span>
          <h1>角色标签审查</h1>
          <p>范围锁定 → 标签生产 → 参考图审查 → 人工裁决</p>
        </div>
        <button type="button" data-testid="character-return" onClick={c.returnToAnnotation}>
          返回标注生产
        </button>
      </header>
      {!c.projectId ? (
        <p role="status">请先在项目档案中选择一个项目。</p>
      ) : (
        <>
          {c.message && (
            <p
              role="status"
              className="dial-archive-character-message"
              data-testid="character-message"
            >
              {c.message}
            </p>
          )}
          {c.issues.map((issue) => (
            <p role="alert" key={issue}>
              {issue}
            </p>
          ))}
          {c.status === "loading" && <p role="status">正在读取审查配置与任务…</p>}
          <div className="dial-archive-character-layout">
            <aside className="dial-archive-character-index">
              <h2>任务档案</h2>
              <button
                type="button"
                data-testid="character-new"
                onClick={() => c.selectOperation(null)}
              >
                ＋ 新建审查
              </button>
              {c.operations.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  data-testid={`character-open-${item.id}`}
                  aria-pressed={op?.id === item.id}
                  onClick={() => c.selectOperation(item.id)}
                >
                  <strong>{item.triggers.join(" / ")}</strong>
                  <small>{CHARACTER_AUDIT_STATUS[item.status]}</small>
                </button>
              ))}
            </aside>
            <main className="dial-archive-character-workspace">
              {!op && <CharacterConfiguration content={c} />}
              {op && (
                <>
                  <section className="dial-archive-character-section">
                    <header>
                      <span>02 / EXECUTION RECORD</span>
                      <h2>{CHARACTER_AUDIT_STATUS[op.status]}</h2>
                    </header>
                    <p>
                      {op.request.profiles.map((p) => p.trigger).join(" / ")} ·{" "}
                      {op.source_assets.length} 张图片 · {op.provider.name} /{" "}
                      {op.provider.model.model_id}
                    </p>
                    {op.error && (
                      <p role="alert" data-testid="character-operation-error">
                        {op.error}
                      </p>
                    )}
                    <p>
                      调用 {op.attempts.length} 次 · 输入{" "}
                      {op.attempts.reduce((sum, a) => sum + (a.response?.input_tokens ?? 0), 0)}{" "}
                      tokens · 输出{" "}
                      {op.attempts.reduce((sum, a) => sum + (a.response?.output_tokens ?? 0), 0)}{" "}
                      tokens
                    </p>
                    {op.prerequisite_job_id && (
                      <p>
                        前置打标任务：{op.prerequisite_job_id}{" "}
                        <button
                          type="button"
                          data-testid="character-open-prerequisite"
                          onClick={c.openPrerequisite}
                        >
                          打开打标任务
                        </button>
                      </p>
                    )}
                    {!op.reviews.length && !ACTIVE.has(op.status) && op.status !== "applied" && (
                      <div className="dial-archive-character-fields">
                        <label>
                          本地打标配置
                          <select
                            data-testid="character-tagger"
                            value={c.taggerProfileId}
                            onChange={(e) => c.setTaggerProfileId(e.target.value)}
                          >
                            <option value="">选择本地打标配置</option>
                            {c.taggers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="dial-archive-character-check">
                          <input
                            data-testid="character-overwrite"
                            type="checkbox"
                            checked={c.overwriteExisting}
                            onChange={(e) => c.setOverwriteExisting(e.target.checked)}
                          />
                          显式覆盖已有 Tags
                        </label>
                        <button
                          type="button"
                          data-testid="character-prepare"
                          disabled={c.busy}
                          onClick={() => void c.prepareTags()}
                        >
                          补齐 Tags 并接续审查
                        </button>
                      </div>
                    )}
                    <div className="dial-archive-character-actions">
                      {["draft", "failed", "stopped", "interrupted"].includes(op.status) && (
                        <button
                          type="button"
                          data-testid="character-start"
                          disabled={c.busy}
                          onClick={() => void c.start()}
                        >
                          使用现有 Tags 启动 / 恢复
                        </button>
                      )}
                      {ACTIVE.has(op.status) && (
                        <button
                          type="button"
                          data-testid="character-stop"
                          disabled={c.busy || op.status === "stopping"}
                          onClick={() => void c.stop()}
                        >
                          停止并保留阶段
                        </button>
                      )}
                    </div>
                    <details>
                      <summary>查看逐阶段调用记录</summary>
                      <ol>
                        {op.attempts.map((a) => (
                          <li key={a.id}>
                            角色 {a.profile_index + 1} · {a.stage} · 第 {a.attempt} 次 · {a.status}{" "}
                            · {a.started_at}
                            {a.error && <p>{a.error}</p>}
                            <details>
                              <summary>请求与返回</summary>
                              <pre>{a.request_user}</pre>
                              <pre>{a.response?.content}</pre>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </section>
                  {op.reviews.length > 0 && <CharacterReview content={c} />}
                  {op.status === "review" && <CharacterApply content={c} />}
                  {op.status === "applied" && (
                    <p data-testid="character-applied">
                      应用完成 · {op.applied_revision_ids.length} 个 Tags 新修订，整份 Tags
                      仍需独立复核。
                    </p>
                  )}
                </>
              )}
            </main>
          </div>
        </>
      )}
    </article>
  );
}
