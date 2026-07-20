import { useMemo } from "react";

import { useProviderModelSearch } from "../../../features/presets/hooks";
import { providerCapabilities } from "../../../features/presets/providerCapabilities";
import type {
  ProviderModelConfig,
  ProviderProtocolOptions,
  ProviderType,
  ReasoningEffort,
} from "../../../shared/api/types";

interface ProviderModelConfigEditorProps {
  providerType: ProviderType;
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  value: ProviderModelConfig;
  onChange: (value: ProviderModelConfig) => void;
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

const allReasoningEfforts = Object.keys(reasoningLabels) as ReasoningEffort[];

export function ProviderModelConfigEditor({
  providerType,
  baseUrl,
  profileId,
  apiKey,
  value,
  onChange,
}: ProviderModelConfigEditorProps) {
  const capabilities = providerCapabilities[providerType];
  const canInspectCatalogCapabilities =
    capabilities.modelCatalog !== null && capabilities.modelCatalog !== "openai_compatible";
  const catalog = useProviderModelSearch(
    {
      profile_id: profileId,
      provider_type: providerType,
      base_url: baseUrl || undefined,
      api_key: apiKey || undefined,
      query: value.model_id,
      limit: 40,
    },
    Boolean(
      canInspectCatalogCapabilities &&
      (capabilities.modelCatalog === "codex" || baseUrl.trim()) &&
      value.model_id,
    ),
  );
  const summary = catalog.data?.find((candidate) => candidate.id === value.model_id);
  const temperatureNotSupported =
    providerType !== "codex" &&
    Boolean(summary?.capabilities_known && !summary.supported_parameters.includes("temperature"));
  const allowedEfforts = useMemo(
    () => reasoningEfforts(providerType, summary),
    [providerType, summary],
  );
  const options = value.protocol_options;
  const currentEffort = options.provider_type === "gemini" ? null : options.reasoning_effort;
  const effortChoices =
    currentEffort && !allowedEfforts.includes(currentEffort)
      ? [currentEffort, ...allowedEfforts]
      : allowedEfforts;
  const effortNotConfirmed = Boolean(
    currentEffort && summary?.capabilities_known && !allowedEfforts.includes(currentEffort),
  );

  function setField<K extends keyof ProviderModelConfig>(
    field: K,
    nextValue: ProviderModelConfig[K],
  ) {
    onChange({ ...value, [field]: nextValue });
  }

  function setProtocolOption(field: string, nextValue: unknown) {
    onChange({
      ...value,
      protocol_options: {
        ...value.protocol_options,
        [field]: nextValue,
      } as ProviderProtocolOptions,
    });
  }

  return (
    <section className="provider-model-config form-field--wide">
      <header>
        <div>
          <span className="eyebrow">Model parameters</span>
          <strong>{value.model_id}</strong>
        </div>
        {catalog.isFetching ? <small>正在刷新模型能力…</small> : null}
      </header>

      <div className="form-grid provider-model-config__fields">
        {providerType !== "codex" ? (
          <>
            <label className="form-field">
              <span>温度</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={value.temperature ?? ""}
                placeholder="不发送"
                onChange={(event) =>
                  setField(
                    "temperature",
                    event.target.value === "" ? null : Number(event.target.value),
                  )
                }
              />
              {temperatureNotSupported ? (
                <small className="provider-option-note provider-option-note--error">
                  目录声明当前模型不接收 temperature；请清空该值。
                </small>
              ) : null}
            </label>
            <label className="form-field">
              <span>最大输出长度</span>
              <input
                type="number"
                min="1"
                max={summary?.max_output_tokens ?? 1_000_000}
                value={value.max_output_tokens}
                onChange={(event) => setField("max_output_tokens", Number(event.target.value))}
              />
              {summary?.max_output_tokens ? (
                <small className="provider-option-note">
                  目录上限 {summary.max_output_tokens.toLocaleString("zh-CN")} Token
                </small>
              ) : null}
            </label>
          </>
        ) : (
          <p className="provider-option-note form-field--wide">
            Codex Runtime 当前不接受温度或输出 Token 上限；仅保存并应用超时与推理强度。
          </p>
        )}

        <label className="form-field">
          <span>超时（秒）</span>
          <input
            type="number"
            min="1"
            max="3600"
            value={value.timeout_seconds}
            onChange={(event) => setField("timeout_seconds", Number(event.target.value))}
          />
        </label>

        {providerType !== "codex" && providerType !== "opencode_go" ? (
          <>
            <label className="form-field">
              <span>Top P（可选）</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={value.top_p ?? ""}
                placeholder="不发送"
                onChange={(event) =>
                  setField("top_p", event.target.value === "" ? null : Number(event.target.value))
                }
              />
            </label>
            <label className="form-field">
              <span>随机种子（可选）</span>
              <input
                type="number"
                min="0"
                value={value.seed ?? ""}
                placeholder="不发送"
                onChange={(event) =>
                  setField("seed", event.target.value === "" ? null : Number(event.target.value))
                }
              />
            </label>
          </>
        ) : null}

        {options.provider_type !== "gemini" ? (
          <label className="form-field">
            <span>推理强度</span>
            <select
              value={currentEffort ?? ""}
              disabled={Boolean(summary?.capabilities_known && !effortChoices.length)}
              onChange={(event) =>
                setProtocolOption(
                  "reasoning_effort",
                  (event.target.value || null) as ReasoningEffort | null,
                )
              }
            >
              <option value="">模型默认 · 不指定</option>
              {effortChoices.map((effort) => (
                <option key={effort} value={effort}>
                  {reasoningLabels[effort]}
                  {effortNotConfirmed && effort === currentEffort ? " · 目录未确认" : ""}
                </option>
              ))}
            </select>
            {providerType === "openai_compatible" ? (
              <small className="provider-option-note">
                通用 /models 通常不声明推理档位；保存允许，实际支持情况由远端服务校验。
              </small>
            ) : null}
            {effortNotConfirmed ? (
              <small className="provider-option-note provider-option-note--error">
                最新目录没有确认这个档位；配置已保留，请核对后再运行任务。
              </small>
            ) : null}
          </label>
        ) : null}

        {options.provider_type === "openrouter" ? (
          <>
            <label className="form-field">
              <span>服务等级</span>
              <select
                value={options.service_tier ?? ""}
                onChange={(event) => setProtocolOption("service_tier", event.target.value || null)}
              >
                <option value="">默认 · 不指定</option>
                <option value="flex">Flex · 更低成本，延迟更高</option>
                <option value="priority">Priority · 更快，成本更高</option>
              </select>
            </label>
            <label className="form-field">
              <span>提示词缓存</span>
              <select
                value={options.prompt_cache_strategy ?? ""}
                onChange={(event) =>
                  setProtocolOption("prompt_cache_strategy", event.target.value || null)
                }
              >
                <option value="">关闭 · 不添加显式断点</option>
                <option value="explicit_system">System Prompt · cache_control 断点</option>
              </select>
            </label>
          </>
        ) : null}
      </div>

      {catalog.isError ? (
        <p className="provider-option-note provider-option-note--error">
          当前无法刷新模型能力；已保存参数不会被自动修改。
        </p>
      ) : null}
    </section>
  );
}

function reasoningEfforts(
  providerType: ProviderType,
  summary:
    | {
        capabilities_known: boolean;
        reasoning_efforts: string[];
        supported_parameters: string[];
      }
    | undefined,
): ReasoningEffort[] {
  if (summary?.reasoning_efforts.length) {
    return summary.reasoning_efforts.filter(
      (effort): effort is ReasoningEffort => effort in reasoningLabels,
    );
  }
  if (providerType === "openai_compatible") return allReasoningEfforts;
  if (!summary) return providerType === "openrouter" ? allReasoningEfforts : [];
  if (
    providerType === "openrouter" &&
    summary.supported_parameters.some((parameter) =>
      ["reasoning", "reasoning_effort"].includes(parameter),
    )
  ) {
    return allReasoningEfforts;
  }
  return [];
}
