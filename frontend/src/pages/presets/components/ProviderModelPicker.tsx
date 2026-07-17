import { useEffect, useState } from "react";
import { Check, RefreshCw, Search, X } from "lucide-react";

import { useProviderModelSearch } from "../../../features/presets/hooks";
import { providerCapabilities } from "../../../features/presets/providerCapabilities";
import type { ProviderModelSummary, ProviderType } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

interface ProviderModelPickerProps {
  providerType: ProviderType;
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  selectedModel: string;
  onSelect: (model: ProviderModelSummary) => void;
  onClose: () => void;
}

export function ProviderModelPicker({
  providerType,
  baseUrl,
  profileId,
  apiKey,
  selectedModel,
  onSelect,
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

  const isCodex = capabilities.modelCatalog === "codex";

  return (
    <section className="model-picker form-field--wide" aria-label="模型目录">
      <header>
        <div>
          <strong>选择多模态模型</strong>
          <small>
            {isCodex
              ? "当前 ChatGPT 账号可用的 Codex 模型 · 图像输入 / 文本输出"
              : "OpenRouter 模型目录 · 图像输入 / 文本输出"}
          </small>
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
          placeholder={
            isCodex ? "搜索 Codex 模型名称或 ID…" : "搜索模型，例如 Gemini、Claude、GPT…"
          }
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
        {models.data?.map((model) => (
          <button
            type="button"
            key={model.id}
            className={selectedModel === model.id ? "is-selected" : ""}
            onClick={() => onSelect(model)}
          >
            <span className="model-picker__title">
              <strong>{model.name}</strong>
              {selectedModel === model.id ? <Check size={14} /> : null}
            </span>
            <code>{model.id}</code>
            <span className="model-picker__facts">
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
            </span>
            {model.description ? <p>{model.description}</p> : null}
          </button>
        ))}
        {models.isLoading ? <p className="model-picker__message">正在读取模型目录…</p> : null}
        {models.isError ? (
          <p className="model-picker__message model-picker__message--error">
            {models.error instanceof Error ? models.error.message : "无法读取模型目录。"}
          </p>
        ) : null}
        {!models.isLoading && !models.isError && !models.data?.length ? (
          <p className="model-picker__message">没有找到匹配的多模态模型。</p>
        ) : null}
      </div>
    </section>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimNumber(value / 1_000)}K`;
  return String(value);
}

function formatPrice(value: string | null): string | null {
  if (value === null) return null;
  const perMillion = Number(value) * 1_000_000;
  if (!Number.isFinite(perMillion)) return null;
  if (perMillion === 0) return "免费";
  return `$${trimNumber(perMillion)} / M`;
}

function trimNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}
