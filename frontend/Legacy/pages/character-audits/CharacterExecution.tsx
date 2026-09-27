import {
  ACTIVE_CHARACTER_AUDIT_STATUSES as ACTIVE,
  CHARACTER_AUDIT_STATUS,
  type CharacterAuditContent,
} from "../../../src/application/characterAudits/characterAuditModel";
import { Button } from "../../shared/ui/Button";

export function CharacterExecution({ content: c }: { content: CharacterAuditContent }) {
  const op = c.operation;
  if (!op) return null;
  return (
    <section className="legacy-character-section" data-surface-region="content">
      <header>
        <span className="eyebrow">执行记录</span>
        <h2>{CHARACTER_AUDIT_STATUS[op.status]}</h2>
      </header>
      <p>
        {op.request.profiles.map((p) => p.trigger).join(" / ")} · {op.source_assets.length} 张图片 ·{" "}
        {op.provider.name} / {op.provider.model.model_id}
      </p>
      {op.error && (
        <p role="alert" data-testid="character-operation-error">
          {op.error}
        </p>
      )}
      <p>
        调用 {op.attempts.length} 次 · 输入{" "}
        {op.attempts.reduce((sum, a) => sum + (a.response?.input_tokens ?? 0), 0)} tokens · 输出{" "}
        {op.attempts.reduce((sum, a) => sum + (a.response?.output_tokens ?? 0), 0)} tokens
      </p>
      {op.prerequisite_job_id && (
        <p>
          前置打标任务：{op.prerequisite_job_id}{" "}
          <Button
            type="button"
            data-testid="character-open-prerequisite"
            onClick={c.openPrerequisite}
          >
            打开打标任务
          </Button>
        </p>
      )}
      {!op.reviews.length && !ACTIVE.has(op.status) && op.status !== "applied" && (
        <div className="legacy-character-fields">
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
          <label className="legacy-character-check">
            <input
              data-testid="character-overwrite"
              type="checkbox"
              checked={c.overwriteExisting}
              onChange={(e) => c.setOverwriteExisting(e.target.checked)}
            />
            显式覆盖已有 Tags
          </label>
          <Button
            type="button"
            data-testid="character-prepare"
            disabled={c.busy}
            onClick={() => void c.prepareTags()}
          >
            补齐 Tags 并接续审查
          </Button>
        </div>
      )}
      <div className="legacy-character-actions">
        {["draft", "failed", "stopped", "interrupted"].includes(op.status) && (
          <Button
            type="button"
            data-testid="character-start"
            disabled={c.busy}
            onClick={() => void c.start()}
          >
            使用现有 Tags 启动 / 恢复
          </Button>
        )}
        {ACTIVE.has(op.status) && (
          <Button
            type="button"
            data-testid="character-stop"
            disabled={c.busy || op.status === "stopping"}
            onClick={() => void c.stop()}
          >
            停止并保留阶段
          </Button>
        )}
      </div>
      <details>
        <summary>查看逐阶段调用记录</summary>
        <ol>
          {op.attempts.map((a) => (
            <li key={a.id}>
              角色 {a.profile_index + 1} · {a.stage} · 第 {a.attempt} 次 · {a.status} ·{" "}
              {a.started_at}
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
  );
}
