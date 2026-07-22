import { useEffect, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAnnotationTrace, usePromptPreview } from "../../../features/assets/hooks";
import { useSystemPresets } from "../../../features/presets/hooks";
import { useUpdateWorkspace } from "../../../features/workspaces/hooks";
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import type {
  AssetAnnotationTrace,
  AssetSummary,
  WorkspaceSummary,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";

interface PromptSettingsPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
}

const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  running: "请求中",
  succeeded: "已成功",
  validation_failed: "输出校验失败",
  skipped_existing: "已有标注，已跳过",
  request_failed: "请求失败",
  internal_error: "内部错误",
  interrupted: "已中断",
  inference_failed: "本地推理失败",
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI 兼容",
  opencode_go: "OpenCode Go",
  gemini: "Gemini",
  codex: "Codex",
  local_tagger: "本地打标器",
};

function TraceMessageCard({
  label,
  detail,
  content,
  empty,
  tone = "default",
}: {
  label: string;
  detail: string;
  content: string | null;
  empty: string;
  tone?: "default" | "reasoning" | "final";
}) {
  return (
    <article className={`prompt-message-card prompt-message-card--${tone}`}>
      <header>
        <span>{label}</span>
        <small>{detail}</small>
      </header>
      <pre className={!content ? "is-empty" : undefined}>{content || empty}</pre>
    </article>
  );
}

function AnnotationTraceView({ trace }: { trace: AssetAnnotationTrace }) {
  const parameters = trace.request.parameters;
  const tokenMetrics = [
    ["输入", trace.response.input_tokens],
    ["缓存命中", trace.response.cache_read_tokens],
    ["推理", trace.response.reasoning_tokens],
    ["总输出", trace.response.output_tokens],
  ].filter((entry): entry is [string, number] => entry[1] !== null);
  const attemptLabel = ATTEMPT_STATUS_LABELS[trace.attempt_status] ?? trace.attempt_status;
  const providerLabel = PROVIDER_LABELS[parameters.provider_type] ?? parameters.provider_type;
  const localTagger = parameters.execution_backend === "local_tagger";

  return (
    <div className="annotation-trace">
      <div className="annotation-trace__summary">
        <div>
          <strong>
            {providerLabel} · {parameters.model}
          </strong>
          <span>
            {new Date(trace.started_at).toLocaleString()} · 第 {trace.attempt_number} 次尝试 ·{" "}
            {attemptLabel}
          </span>
        </div>
        <span
          className={`annotation-trace__match ${
            trace.matches_current_annotation ? "is-matched" : "is-unmatched"
          }`}
        >
          {trace.matches_current_annotation
            ? "匹配当前 TXT"
            : trace.annotation_exists
              ? "与当前 TXT 不同"
              : "当前无 TXT"}
        </span>
      </div>

      {trace.request.source === "reconstructed" ? (
        <p className="prompt-config-warning">
          这是旧任务，调用时尚未保存独立请求快照。下方 Prompt
          由任务快照与当前元数据重建，可能与当时的实际请求略有差异。
        </p>
      ) : null}
      {!trace.matches_current_annotation && trace.annotation_exists ? (
        <p className="annotation-trace__notice">
          当前标注在这次模型响应之后被编辑或替换；这里展示最近一次可追溯的模型请求。
        </p>
      ) : null}

      <dl className="annotation-trace__parameters">
        <div>
          <dt>{localTagger ? "打标配置" : "API 配置"}</dt>
          <dd>{parameters.provider_profile_name}</dd>
        </div>
        <div>
          <dt>{localTagger ? "执行设备" : "推理强度"}</dt>
          <dd>
            {localTagger
              ? (parameters.device ?? "未记录")
              : (parameters.reasoning_effort ?? "未显式设置")}
          </dd>
        </div>
        <div>
          <dt>{localTagger ? "统一阈值" : "最大输出"}</dt>
          <dd>
            {localTagger
              ? (parameters.threshold ?? "未记录")
              : parameters.max_output_tokens === null
                ? "未记录"
                : `${parameters.max_output_tokens.toLocaleString()} Token`}
          </dd>
        </div>
        <div>
          <dt>{localTagger ? "标签类别" : "温度"}</dt>
          <dd>
            {localTagger
              ? (parameters.categories?.join("、") ?? "未记录")
              : (parameters.temperature ?? "模型默认")}
          </dd>
        </div>
      </dl>

      <div className="prompt-request-preview">
        {!localTagger ? (
          <>
            <TraceMessageCard
              label="SYSTEM"
              detail={trace.request.source === "recorded" ? "实际请求快照" : "历史任务重建"}
              content={trace.request.system_prompt}
              empty="这次请求没有 System Prompt。"
            />
            <TraceMessageCard
              label="USER"
              detail="图片作为同一条 USER 消息的图像内容发送"
              content={trace.request.user_prompt}
              empty="这次请求没有 User Prompt。"
            />
            <TraceMessageCard
              label="REASONING"
              detail={
                trace.response.reasoning_tokens === null
                  ? "供应商返回的可见推理"
                  : `${trace.response.reasoning_tokens.toLocaleString()} Token`
              }
              content={trace.response.reasoning_content}
              empty="供应商没有返回可展示的推理内容；这不代表模型没有进行内部推理。"
              tone="reasoning"
            />
          </>
        ) : null}
        <TraceMessageCard
          label={localTagger ? "TAGS" : "FINAL"}
          detail={
            localTagger
              ? "本地模型写入 TXT 的标签列表"
              : trace.response.finish_reason
                ? `结束原因：${trace.response.finish_reason}`
                : "最终输出"
          }
          content={trace.response.final_content}
          empty="这次尝试没有可用的最终输出。"
          tone="final"
        />
      </div>

      {trace.response.error_message ? (
        <p className="form-error">
          {localTagger ? "本地推理异常" : "请求异常"}：{trace.response.error_message}
        </p>
      ) : null}
      {tokenMetrics.length ? (
        <div className="annotation-trace__tokens">
          {tokenMetrics.map(([label, value]) => (
            <span key={label}>
              {label} {value.toLocaleString()}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PromptSettingsPanel({ projectId, workspace, asset }: PromptSettingsPanelProps) {
  const navigate = useNavigate();
  const systemPresets = useSystemPresets();
  const [systemPresetId, setSystemPresetId] = useState(workspace.settings.system_preset_id ?? "");
  const [prompt, setPrompt] = useState(workspace.settings.user_prompt);
  const [recordView, setRecordView] = useState<"trace" | "preview">("trace");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateWorkspace(projectId);
  const preview = usePromptPreview(projectId, asset?.id ?? null);
  const trace = useAnnotationTrace(projectId, asset?.id ?? null);

  useEffect(() => {
    setSystemPresetId(workspace.settings.system_preset_id ?? "");
    setPrompt(workspace.settings.user_prompt);
  }, [workspace.settings.system_preset_id, workspace.settings.user_prompt]);
  const dirty =
    systemPresetId !== (workspace.settings.system_preset_id ?? "") ||
    prompt !== workspace.settings.user_prompt;
  useUnsavedScope(`workspace-prompt:${projectId}`, dirty);

  const selectedPresetExists = Boolean(
    systemPresets.data?.some((preset) => preset.id === systemPresetId),
  );
  const savedPresetMissing = Boolean(
    systemPresets.isSuccess &&
    workspace.settings.system_preset_id &&
    !systemPresets.data.some((preset) => preset.id === workspace.settings.system_preset_id),
  );

  function openPresetLibrary() {
    void (async () => {
      if (dirty) {
        const confirmed = await confirmDialog("项目提示词配置尚未保存，前往全局预设会丢弃修改。", {
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃并前往",
          cancelLabel: "继续编辑",
        });
        if (!confirmed) return;
      }
      navigate("/presets");
    })();
  }

  async function savePrompt() {
    setError(null);
    if (!systemPresetId || !selectedPresetExists) {
      setError("请先选择一个有效的 System Prompt 预设。");
      return;
    }
    try {
      await update.mutateAsync({ system_preset_id: systemPresetId, user_prompt: prompt });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存项目提示词配置失败。");
    }
  }

  return (
    <>
      <section className="inspector-section">
        <div className="section-heading-row">
          <span className="section-kicker">项目提示词配置</span>
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>
        <label className="form-field prompt-preset-field">
          <span>System Prompt 预设</span>
          <select
            value={systemPresetId}
            disabled={systemPresets.isLoading || !systemPresets.data?.length}
            onChange={(event) => setSystemPresetId(event.target.value)}
          >
            <option value="">
              {systemPresets.isLoading
                ? "正在读取预设…"
                : systemPresets.data?.length
                  ? "请选择项目使用的预设"
                  : "尚未创建 System Prompt 预设"}
            </option>
            {systemPresets.isSuccess && systemPresetId && !selectedPresetExists ? (
              <option value={systemPresetId}>原预设已不存在</option>
            ) : null}
            {systemPresets.data?.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        {savedPresetMissing ? (
          <p className="prompt-config-warning">原先关联的全局预设已不存在，请重新选择。</p>
        ) : null}
        {systemPresets.isError ? (
          <p className="form-error">
            {systemPresets.error instanceof Error
              ? systemPresets.error.message
              : "读取 System Prompt 预设失败。"}
          </p>
        ) : null}
        <label className="prompt-user-field">
          <span>项目 User Prompt</span>
          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入在当前项目中保持稳定的 User Prompt…"
          />
        </label>
        <div className="prompt-config-actions">
          <Button icon={<Settings2 size={14} />} onClick={openPresetLibrary}>
            管理全局预设
          </Button>
          <Button
            tone="primary"
            icon={update.isPending ? <Spinner /> : <Save size={14} />}
            onClick={() => void savePrompt()}
            disabled={!dirty || update.isPending || !systemPresetId || !selectedPresetExists}
          >
            保存项目配置
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <section className="inspector-section inspector-section--grow">
        <div className="section-heading-row">
          <span className="section-kicker">当前图片请求与响应</span>
        </div>
        <div className="prompt-record-switch" role="tablist" aria-label="提示词记录视图">
          <button
            role="tab"
            aria-selected={recordView === "trace"}
            className={recordView === "trace" ? "is-active" : ""}
            onClick={() => setRecordView("trace")}
          >
            本次标注记录
          </button>
          <button
            role="tab"
            aria-selected={recordView === "preview"}
            className={recordView === "preview" ? "is-active" : ""}
            onClick={() => setRecordView("preview")}
          >
            下次请求预览
          </button>
        </div>

        {recordView === "trace" ? (
          asset ? (
            trace.isError ? (
              <p className="form-error">
                {trace.error instanceof Error ? trace.error.message : "读取标注记录失败。"}
              </p>
            ) : trace.isLoading ? (
              <Spinner label="读取标注记录" />
            ) : trace.data ? (
              <AnnotationTraceView trace={trace.data} />
            ) : (
              <p className="quiet-copy">
                当前图片还没有模型请求记录。手动标注不会产生模型 Prompt 或推理记录。
              </p>
            )
          ) : (
            <p className="quiet-copy">选择图片后查看对应的模型请求、推理和最终输出。</p>
          )
        ) : (
          <>
            {dirty ? <p className="quiet-copy">下方预览仍以最后保存的项目配置为准。</p> : null}
            {asset ? (
              preview.isError ? (
                <p className="form-error">
                  {preview.error instanceof Error
                    ? preview.error.message
                    : "读取最终 Prompt 失败。"}
                </p>
              ) : preview.data ? (
                <div className="prompt-request-preview">
                  {preview.data.configuration_issue ? (
                    <p className="prompt-config-warning">{preview.data.configuration_issue}</p>
                  ) : null}
                  <article className="prompt-message-card">
                    <header>
                      <span>SYSTEM</span>
                      <small>{preview.data.system_preset_name ?? "未配置预设"}</small>
                    </header>
                    <pre>{preview.data.system_prompt || "尚未保存 System Prompt 预设。"}</pre>
                  </article>
                  <article className="prompt-message-card">
                    <header>
                      <span>USER</span>
                      <small>
                        {preview.data.metadata_lines.length
                          ? `项目内容 + ${preview.data.metadata_lines.length} 行元数据`
                          : "项目内容"}
                      </small>
                    </header>
                    <pre>{preview.data.final_user_prompt || "User Prompt 当前为空。"}</pre>
                  </article>
                  <p className="prompt-image-note">当前图片会与 USER 消息一起发送给多模态模型。</p>
                </div>
              ) : (
                <Spinner label="拼装最终请求" />
              )
            ) : (
              <p className="quiet-copy">选择图片后预览下一次最终发送内容。</p>
            )}
          </>
        )}
      </section>
    </>
  );
}
