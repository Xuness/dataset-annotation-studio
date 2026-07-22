import { useEffect, useState } from "react";
import { Check, RefreshCw, Search, X } from "lucide-react";

import { useProviderModelSearch } from "../../../../features/presets/hooks";
import type { ProviderModelSummary } from "../../../../shared/api/types";
import { Button } from "../../../../shared/ui/Button";
import { Spinner } from "../../../../shared/ui/Spinner";
import { formatModalities, formatPrice, formatTokens } from "../modelCatalogFormatting";

interface OpenCodeGoModelPickerProps {
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  selectedModels: string[];
  onToggle: (model: ProviderModelSummary) => void;
  onClose: () => void;
}

export function OpenCodeGoModelPicker({
  baseUrl,
  profileId,
  apiKey,
  selectedModels,
  onToggle,
  onClose,
}: OpenCodeGoModelPickerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const models = useProviderModelSearch(
    {
      profile_id: profileId,
      provider_type: "opencode_go",
      base_url: baseUrl || undefined,
      api_key: apiKey || undefined,
      query: debouncedQuery,
      limit: 40,
    },
    Boolean(baseUrl.trim()),
  );

  return (
    <section className="model-picker form-field--wide" aria-label="OpenCode Go 模型目录">
      <header>
        <div>
          <strong>选择 OpenCode Go 模型</strong>
          <small>实时目录与已登记协议规格的交集 · 包含纯文本与多模态模型</small>
        </div>
        <Button type="button" icon={<X size={13} />} onClick={onClose}>
          关闭
        </Button>
      </header>
      <div className="model-picker__search">
        <Search size={14} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 Grok、Kimi、Qwen、MiniMax…"
        />
        <Button
          type="button"
          icon={models.isFetching ? <Spinner /> : <RefreshCw size={13} />}
          disabled={models.isFetching}
          onClick={() => void models.refetch()}
        >
          刷新
        </Button>
      </div>
      <div className="model-picker__results">
        {models.data?.map((model) => {
          const explicitCache = model.supported_parameters.includes("explicit_prompt_cache");
          const selected = selectedModels.includes(model.id);
          return (
            <button
              type="button"
              key={model.id}
              className={selected ? "is-selected" : ""}
              onClick={() => onToggle(model)}
            >
              <span className="model-picker__title">
                <strong>{model.name}</strong>
                {selected ? <Check size={14} /> : null}
              </span>
              <code>{model.id}</code>
              <span className="model-picker__facts">
                {model.input_modalities.length ? (
                  <small>输入 {formatModalities(model.input_modalities)}</small>
                ) : null}
                <small>{explicitCache ? "Messages 通道" : "Chat Completions"}</small>
                {model.context_length ? (
                  <small>{formatTokens(model.context_length)} 上下文</small>
                ) : null}
                {model.max_output_tokens ? (
                  <small>{formatTokens(model.max_output_tokens)} 最大输出</small>
                ) : null}
                {formatPrice(model.prompt_price) ? (
                  <small>输入 {formatPrice(model.prompt_price)}</small>
                ) : null}
                {formatPrice(model.completion_price) ? (
                  <small>输出 {formatPrice(model.completion_price)}</small>
                ) : null}
                {model.reasoning_efforts.length ? (
                  <small>推理 {model.reasoning_efforts.join(" / ")}</small>
                ) : null}
                <small>{explicitCache ? "显式缓存" : "自动缓存"}</small>
              </span>
              {model.description ? <p>{model.description}</p> : null}
            </button>
          );
        })}
        {models.isLoading ? <p className="model-picker__message">正在读取模型目录…</p> : null}
        {models.isError ? (
          <p className="model-picker__message model-picker__message--error">
            {models.error instanceof Error
              ? models.error.message
              : "无法读取 OpenCode Go 模型目录。"}
          </p>
        ) : null}
        {!models.isLoading && !models.isError && !models.data?.length ? (
          <p className="model-picker__message">没有找到已登记且当前可用的模型。</p>
        ) : null}
      </div>
    </section>
  );
}
