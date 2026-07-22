import { useEffect, useState } from "react";
import { Check, RefreshCw, Search, X } from "lucide-react";

import { useProviderModelSearch } from "../../../features/presets/hooks";
import { providerCapabilities } from "../../../features/presets/providerCapabilities";
import type { ProviderModelSummary, ProviderType } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { formatModalities, formatPrice, formatTokens } from "./modelCatalogFormatting";

interface ProviderModelPickerProps {
  providerType: ProviderType;
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  selectedModels: string[];
  onToggle: (model: ProviderModelSummary) => void;
  onClose: () => void;
}

export function ProviderModelPicker({
  providerType,
  baseUrl,
  profileId,
  apiKey,
  selectedModels,
  onToggle,
  onClose,
}: ProviderModelPickerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const capabilities = providerCapabilities[providerType];

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const models = useProviderModelSearch(
    {
      profile_id: profileId,
      provider_type: providerType,
      base_url: baseUrl || undefined,
      api_key: apiKey || undefined,
      query: debouncedQuery,
      limit: 40,
    },
    capabilities.modelCatalog === "codex" || Boolean(baseUrl.trim()),
  );

  const catalogDescription =
    capabilities.modelCatalog === "codex"
      ? "当前 ChatGPT 账号可用的 Codex 模型 · 包含纯文本与多模态模型"
      : capabilities.modelCatalog === "openai_compatible"
        ? "远端 OpenAI 兼容模型目录 · 未声明的能力不会被推测"
        : "OpenRouter 完整模型目录 · 包含纯文本与多模态模型";
  const searchPlaceholder =
    capabilities.modelCatalog === "codex"
      ? "搜索 Codex 模型名称或 ID…"
      : capabilities.modelCatalog === "openai_compatible"
        ? "搜索远端模型 ID 或名称…"
        : "搜索模型，例如 Gemini、Claude、GPT…";

  return (
    <section className="model-picker form-field--wide" aria-label="模型目录">
      <header>
        <div>
          <strong>选择模型</strong>
          <small>{catalogDescription}</small>
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
          placeholder={searchPlaceholder}
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
                {model.reasoning_efforts.length ? <small>支持推理强度</small> : null}
                {!model.capabilities_known ? <small>参数能力未完整声明</small> : null}
              </span>
              {model.description ? <p>{model.description}</p> : null}
            </button>
          );
        })}
        {models.isLoading ? <p className="model-picker__message">正在读取模型目录…</p> : null}
        {models.isError ? (
          <p className="model-picker__message model-picker__message--error">
            {models.error instanceof Error ? models.error.message : "无法读取模型目录。"}
          </p>
        ) : null}
        {!models.isLoading && !models.isError && !models.data?.length ? (
          <p className="model-picker__message">没有找到匹配的模型。</p>
        ) : null}
      </div>
    </section>
  );
}
