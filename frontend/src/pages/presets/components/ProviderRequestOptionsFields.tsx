import type { ProviderRequestOptions, ProviderType } from "../../../shared/api/types";

interface ProviderRequestOptionsFieldsProps {
  providerType: ProviderType;
  value: ProviderRequestOptions;
  onChange: (value: ProviderRequestOptions) => void;
}

export function ProviderRequestOptionsFields({
  providerType,
  value,
  onChange,
}: ProviderRequestOptionsFieldsProps) {
  function setOption<K extends keyof ProviderRequestOptions>(
    field: K,
    nextValue: ProviderRequestOptions[K],
  ) {
    onChange({ ...value, [field]: nextValue });
  }

  return (
    <>
      <div className="provider-options-heading form-field--wide">
        <span className="eyebrow">Generation controls</span>
        <strong>生成参数</strong>
        <small>留空的参数不会发送，交由模型或供应商使用默认值。</small>
      </div>
      <label className="form-field">
        <span>Top P（可选）</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={value.top_p ?? ""}
          placeholder="供应商默认"
          onChange={(event) =>
            setOption("top_p", event.target.value ? Number(event.target.value) : null)
          }
        />
      </label>
      <label className="form-field">
        <span>随机种子（可选）</span>
        <input
          type="number"
          min="0"
          value={value.seed ?? ""}
          placeholder="不指定"
          onChange={(event) =>
            setOption("seed", event.target.value ? Number(event.target.value) : null)
          }
        />
      </label>
      {providerType === "openrouter" ? (
        <>
          <label className="form-field">
            <span>服务等级</span>
            <select
              value={value.service_tier ?? ""}
              onChange={(event) =>
                setOption(
                  "service_tier",
                  (event.target.value || null) as ProviderRequestOptions["service_tier"],
                )
              }
            >
              <option value="">默认 · 不指定</option>
              <option value="flex">Flex · 更低成本，延迟更高</option>
              <option value="priority">Priority · 更快，成本更高</option>
            </select>
          </label>
          <label className="form-field">
            <span>推理强度</span>
            <select
              value={value.reasoning_effort ?? ""}
              onChange={(event) =>
                setOption(
                  "reasoning_effort",
                  (event.target.value || null) as ProviderRequestOptions["reasoning_effort"],
                )
              }
            >
              <option value="">模型默认 · 不指定</option>
              <option value="max">Max · 最大</option>
              <option value="xhigh">XHigh · 极高</option>
              <option value="high">High · 高</option>
              <option value="medium">Medium · 中</option>
              <option value="low">Low · 低</option>
              <option value="minimal">Minimal · 最低</option>
              <option value="none">None · 关闭推理</option>
            </select>
          </label>
        </>
      ) : null}
    </>
  );
}
