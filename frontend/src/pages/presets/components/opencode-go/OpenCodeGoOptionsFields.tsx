import { useEffect, useMemo } from "react";

import { useProviderModelSearch } from "../../../../features/presets/hooks";
import type { ProviderRequestOptions, ReasoningEffort } from "../../../../shared/api/types";

interface OpenCodeGoOptionsFieldsProps {
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  requestOptions: ProviderRequestOptions;
  onTemperatureChange: (value: number) => void;
  onMaxOutputTokensChange: (value: number) => void;
  onRequestOptionsChange: (value: ProviderRequestOptions) => void;
}

const reasoningLabels: Record<ReasoningEffort, string> = {
  max: "Max · 最大",
  xhigh: "XHigh · 极高",
  high: "High · 高",
  medium: "Medium · 中",
  low: "Low · 低",
  minimal: "Minimal · 最低",
  none: "None · 关闭",
};

export function OpenCodeGoOptionsFields({
  baseUrl,
  profileId,
  apiKey,
  model,
  temperature,
  maxOutputTokens,
  requestOptions,
  onTemperatureChange,
  onMaxOutputTokensChange,
  onRequestOptionsChange,
}: OpenCodeGoOptionsFieldsProps) {
  const models = useProviderModelSearch(
    {
      profile_id: profileId,
      provider_type: "opencode_go",
      base_url: baseUrl || undefined,
      api_key: apiKey || undefined,
      query: model,
      limit: 40,
    },
    Boolean(baseUrl.trim() && model.trim()),
  );
  const spec = models.data?.find((candidate) => candidate.id === model);
  const supportsTemperature = spec?.supported_parameters.includes("temperature") ?? true;
  const allowedEfforts = useMemo(
    () => (spec?.reasoning_efforts ?? []) as ReasoningEffort[],
    [spec],
  );

  useEffect(() => {
    const current = requestOptions.reasoning_effort;
    if (spec && current && !allowedEfforts.includes(current)) {
      onRequestOptionsChange({ ...requestOptions, reasoning_effort: null });
    }
  }, [allowedEfforts, onRequestOptionsChange, requestOptions, spec]);

  const cacheDescription = spec?.supported_parameters.includes("explicit_prompt_cache")
    ? "Messages 通道会把稳定的 System Prompt 标记为 ephemeral 缓存断点；缓存写入与读取 Token 会分别记录。"
    : spec?.supported_parameters.includes("automatic_prompt_cache")
      ? "Chat Completions 通道使用 OpenCode Go 的自动前缀缓存，不发送 cache_control；缓存命中 Token 会记录。"
      : "选择已登记模型后会显示其传输协议、推理强度与缓存策略。";

  return (
    <>
      <div className="provider-options-heading form-field--wide">
        <span className="eyebrow">OpenCode Go controls</span>
        <strong>专用生成参数</strong>
        <small>参数按所选模型规格校验；未支持的字段不会发送到上游。</small>
      </div>
      <label className="form-field">
        <span>温度</span>
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          disabled={!supportsTemperature}
          onChange={(event) => onTemperatureChange(Number(event.target.value))}
        />
        {!supportsTemperature ? (
          <small className="provider-option-note">当前模型不接收 temperature。</small>
        ) : null}
      </label>
      <label className="form-field">
        <span>最大输出长度</span>
        <input
          type="number"
          min="1"
          max={spec?.max_output_tokens ?? 1_000_000}
          value={maxOutputTokens}
          onChange={(event) => onMaxOutputTokensChange(Number(event.target.value))}
        />
        {spec?.max_output_tokens ? (
          <small className="provider-option-note">
            模型上限 {spec.max_output_tokens.toLocaleString("zh-CN")} Token
          </small>
        ) : null}
      </label>
      <label className="form-field form-field--wide">
        <span>推理强度</span>
        <select
          value={spec ? (requestOptions.reasoning_effort ?? "") : ""}
          disabled={!spec || !allowedEfforts.length}
          onChange={(event) =>
            onRequestOptionsChange({
              ...requestOptions,
              reasoning_effort: (event.target.value || null) as ReasoningEffort | null,
            })
          }
        >
          <option value="">模型默认 · 不指定</option>
          {allowedEfforts.map((effort) => (
            <option key={effort} value={effort}>
              {reasoningLabels[effort]}
            </option>
          ))}
        </select>
        <small className="provider-option-note">
          {spec && !allowedEfforts.length
            ? "当前模型没有安全可映射的推理强度，使用模型默认行为。"
            : "只显示当前模型明确支持的档位；Messages 通道会将档位映射为 thinking budget。"}
        </small>
      </label>
      <div className="form-field form-field--wide">
        <span>提示词缓存</span>
        <small className="provider-option-note">{cacheDescription}</small>
        {models.isError ? (
          <small className="provider-option-note provider-option-note--error">
            当前无法刷新模型规格；保存的配置仍会在实际请求前由后端校验。
          </small>
        ) : null}
      </div>
    </>
  );
}
