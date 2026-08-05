import type { AnnotationProjectContextContent } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationProjectContextSurfaceProps {
  context: AnnotationProjectContextContent;
  compact?: boolean;
}

export function AnnotationProjectContextSurface({
  context,
  compact = false,
}: AnnotationProjectContextSurfaceProps) {
  if (context.status === "loading") {
    return (
      <div className="dial-archive-edit-workcell__state is-loading">
        <span>READING PROJECT CONTEXT</span>
        <b>正在读取项目指令</b>
        <i />
      </div>
    );
  }

  const selectedPresetName =
    context.systemPresets.find((preset) => preset.id === context.systemPresetId)?.name ?? "未选择";
  const metadataEvidence =
    context.metadataStatus === "loading" ? (
      <p>正在读取当前素材元数据…</p>
    ) : context.metadataStatus === "missing" ? (
      <p>当前素材没有同名 JSON；它仍可正常参与标注。</p>
    ) : context.metadataStatus === "error" ? (
      <p>{context.message ?? "元数据读取失败。"}</p>
    ) : context.metadataStatus === "no-object" ? (
      <p>选择素材后配置 JSON 上下文字段。</p>
    ) : (
      <>
        <div className="dial-archive-context-surface__fields">
          {context.metadataFields.map((field) => (
            <button
              className={field.selected ? "is-selected" : undefined}
              type="button"
              disabled={context.writePending}
              onClick={() => context.toggleMetadataField(field.id)}
              key={field.id}
            >
              <i aria-hidden="true" />
              {field.id}
            </button>
          ))}
        </div>
        {compact ? (
          <details className="dial-archive-context-surface__raw-register">
            <summary>
              <span>RAW OBJECT EVIDENCE</span>
              <b>{context.metadataFields.length.toString().padStart(2, "0")} FIELDS</b>
            </summary>
            <pre>{context.metadataRaw}</pre>
          </details>
        ) : (
          <pre>{context.metadataRaw}</pre>
        )}
      </>
    );

  return (
    <div className={`dial-archive-context-surface${compact ? " is-inspector" : ""}`}>
      <section className="dial-archive-context-surface__config">
        <header>
          <span>PROJECT INSTRUCTION // WRITABLE</span>
          <h3>模型上下文配置</h3>
          {context.dirty ? <em>UNSAVED</em> : <em className="is-synced">SYNCHRONIZED</em>}
          <strong className="dial-archive-context-surface__index" aria-hidden="true">
            CTX
          </strong>
        </header>

        <label className="dial-archive-context-surface__preset">
          <span>SYSTEM PROMPT PRESET</span>
          <select
            value={context.systemPresetId}
            disabled={context.writePending || !context.systemPresets.length}
            onChange={(event) => context.setSystemPreset(event.target.value)}
          >
            <option value="">请选择项目使用的全局预设</option>
            {context.systemPresets.map((preset) => (
              <option value={preset.id} key={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="dial-archive-context-surface__prompt">
          <span>PROJECT USER PROMPT</span>
          <textarea
            value={context.userPrompt}
            disabled={context.writePending}
            placeholder="输入在当前项目中保持稳定的 User Prompt…"
            onChange={(event) => context.setUserPrompt(event.target.value)}
          />
        </label>

        <label className="dial-archive-context-surface__toggle">
          <input
            type="checkbox"
            checked={context.useTagsAsContext}
            disabled={context.writePending}
            onChange={(event) => context.setUseTagsAsContext(event.target.checked)}
          />
          <span>
            <b>使用当前 Tags 作为请求上下文</b>
            <small>仅冻结与素材版本一致、可用且通过校验的 Tags。</small>
          </span>
        </label>

        <footer>
          {context.actionError || context.message ? (
            <strong>{context.actionError ?? context.message}</strong>
          ) : (
            <span>CTRL+S // SAVE</span>
          )}
          <div>
            <button
              type="button"
              disabled={!context.dirty || context.writePending}
              onClick={context.discard}
            >
              放弃修改
            </button>
            <button
              className="is-primary"
              type="button"
              disabled={!context.canSave}
              onClick={() => void context.save()}
            >
              {context.writePending ? "正在保存" : "保存项目上下文"}
            </button>
          </div>
        </footer>
      </section>

      <aside className="dial-archive-context-surface__evidence">
        {compact ? (
          <>
            <header className="dial-archive-context-surface__evidence-head">
              <span>FROZEN EVIDENCE REGISTER</span>
              <b>02 SOURCES</b>
            </header>
            <details className="dial-archive-context-surface__register">
              <summary>
                <span>SYS.01 // SYSTEM PRESET</span>
                <b>{selectedPresetName}</b>
              </summary>
              <pre>{context.selectedSystemPrompt || "选择预设后在这里核对 System Prompt。"}</pre>
            </details>
            <details className="dial-archive-context-surface__register is-metadata" open>
              <summary>
                <span>OBJ.02 // CONTEXT FIELDS</span>
                <b>{context.metadataPath ?? "NO JSON"}</b>
              </summary>
              {metadataEvidence}
            </details>
          </>
        ) : (
          <>
            <article>
              <header>
                <span>SYSTEM / SELECTED PRESET</span>
                <b>{selectedPresetName}</b>
              </header>
              <pre>{context.selectedSystemPrompt || "选择预设后在这里核对 System Prompt。"}</pre>
            </article>
            <article className="is-metadata">
              <header>
                <span>OBJECT JSON / CONTEXT FIELDS</span>
                <b>{context.metadataPath ?? "NO JSON"}</b>
              </header>
              {metadataEvidence}
            </article>
          </>
        )}
      </aside>
    </div>
  );
}
