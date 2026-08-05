import type {
  AnnotationRequestPreviewContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationRequestPreviewSurfaceProps {
  preview: AnnotationRequestPreviewContent;
  asset: AnnotationStageAsset | null;
  compact?: boolean;
}

export function AnnotationRequestPreviewSurface({
  preview,
  asset,
  compact = false,
}: AnnotationRequestPreviewSurfaceProps) {
  if (preview.status !== "ready") {
    return (
      <div
        className={`dial-archive-edit-workcell__state${preview.status === "loading" ? " is-loading" : preview.status === "error" ? " is-error" : ""}`}
      >
        <span>NEXT REQUEST // {preview.status.toUpperCase()}</span>
        <b>
          {preview.status === "no-object"
            ? "选择素材后预览下一次请求"
            : (preview.message ?? "正在拼装最终请求")}
        </b>
        {preview.status === "loading" ? <i /> : null}
      </div>
    );
  }

  const contextParts = [
    preview.userPrompt ? "项目指令" : null,
    preview.metadataLines.length ? `${preview.metadataLines.length} 行元数据` : null,
    preview.tagContextStatus === "ready" ? `${preview.tagCount} 个 Tags` : null,
  ].filter(Boolean);

  if (compact) {
    return (
      <div className="dial-archive-request-preview is-inspector">
        <header>
          <div>
            <span>NEXT MULTIMODAL REQUEST // MATERIAL LOCK</span>
            <h3>最终请求预览</h3>
          </div>
          <dl>
            <div>
              <dt>OBJECT</dt>
              <dd>{asset?.filename ?? "—"}</dd>
            </div>
            <div>
              <dt>CONTEXT</dt>
              <dd>{contextParts.join(" + ") || "EMPTY"}</dd>
            </div>
          </dl>
        </header>
        {preview.basedOnSavedContext ? (
          <p className="dial-archive-request-preview__notice">
            02 页仍有未保存修改；本页严格展示最后保存配置生成的真实下次请求。
          </p>
        ) : null}
        {preview.configurationIssue ? (
          <p className="dial-archive-request-preview__warning">{preview.configurationIssue}</p>
        ) : null}
        <div className="dial-archive-request-preview__messages">
          <details className="is-system">
            <summary>
              <b>SYS.01 // SYSTEM</b>
              <span>{preview.systemPresetName ?? "未配置预设"}</span>
            </summary>
            <pre>{preview.systemPrompt || "尚未保存 System Prompt 预设。"}</pre>
          </details>
          <details className="is-context">
            <summary>
              <b>CTX.02 // CONTEXT</b>
              <span>{preview.tagContextStatus.toUpperCase()}</span>
            </summary>
            <div>
              {preview.metadataLines.length ? (
                preview.metadataLines.map((line, index) => (
                  <code key={`${index}:${line}`}>{line}</code>
                ))
              ) : (
                <p>没有 JSON 元数据行。</p>
              )}
              <code className={preview.tagLine ? "is-signal" : ""}>
                {preview.tagLine ??
                  (preview.tagContextStatus === "disabled"
                    ? "Tags 上下文未启用。"
                    : "当前素材没有可用 Tags；实际请求会省略 Tags 行。")}
              </code>
            </div>
          </details>
          <details className="is-user" open>
            <summary>
              <b>USR.03 // USER FINAL</b>
              <span>IMAGE ATTACHED</span>
            </summary>
            <pre>{preview.finalUserPrompt || "User Prompt 当前为空。"}</pre>
          </details>
        </div>
        <footer>
          <span>IMAGE PAYLOAD // CURRENT MATERIAL</span>
          <b>当前真彩图像将作为同一条 USER 消息的图像内容发送。</b>
        </footer>
      </div>
    );
  }

  return (
    <div className="dial-archive-request-preview">
      <header>
        <div>
          <span>NEXT MULTIMODAL REQUEST // MATERIAL LOCK</span>
          <h3>最终请求预览</h3>
        </div>
        <dl>
          <div>
            <dt>OBJECT</dt>
            <dd>{asset?.filename ?? "—"}</dd>
          </div>
          <div>
            <dt>CONTEXT</dt>
            <dd>{contextParts.join(" + ") || "EMPTY"}</dd>
          </div>
        </dl>
      </header>
      {preview.basedOnSavedContext ? (
        <p className="dial-archive-request-preview__notice">
          02 页仍有未保存修改；本页严格展示最后保存配置生成的真实下次请求。
        </p>
      ) : null}
      {preview.configurationIssue ? (
        <p className="dial-archive-request-preview__warning">{preview.configurationIssue}</p>
      ) : null}
      <div className="dial-archive-request-preview__messages">
        <article className="is-system">
          <header>
            <b>SYSTEM</b>
            <span>{preview.systemPresetName ?? "未配置预设"}</span>
          </header>
          <pre>{preview.systemPrompt || "尚未保存 System Prompt 预设。"}</pre>
        </article>
        <article className="is-context">
          <header>
            <b>CONTEXT REGISTER</b>
            <span>{preview.tagContextStatus.toUpperCase()}</span>
          </header>
          <div>
            {preview.metadataLines.length ? (
              preview.metadataLines.map((line, index) => (
                <code key={`${index}:${line}`}>{line}</code>
              ))
            ) : (
              <p>没有 JSON 元数据行。</p>
            )}
            <code className={preview.tagLine ? "is-signal" : ""}>
              {preview.tagLine ??
                (preview.tagContextStatus === "disabled"
                  ? "Tags 上下文未启用。"
                  : "当前素材没有可用 Tags；实际请求会省略 Tags 行。")}
            </code>
          </div>
        </article>
        <article className="is-user">
          <header>
            <b>USER / FINAL</b>
            <span>IMAGE ATTACHED</span>
          </header>
          <pre>{preview.finalUserPrompt || "User Prompt 当前为空。"}</pre>
        </article>
      </div>
      <footer>
        <span>IMAGE PAYLOAD // CURRENT MATERIAL</span>
        <b>当前真彩图像将作为同一条 USER 消息的图像内容发送。</b>
      </footer>
    </div>
  );
}
