import { useEffect, useState } from "react";
import { Cable, KeyRound, Plus, Save, Search, Star, Trash2, X } from "lucide-react";

import type { ProviderProfileInput } from "../../../features/presets/api";
import { useProviderProfileMutations, useProviderProfiles } from "../../../features/presets/hooks";
import { providerCapabilities } from "../../../features/presets/providerCapabilities";
import type {
  ProviderModelSummary,
  ProviderProfile,
  ProviderType,
} from "../../../shared/api/types";
import { useUnsavedChangesGuard, useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { CodexConnectionPanel } from "./CodexConnectionPanel";
import { OpenCodeGoModelPicker } from "./opencode-go/OpenCodeGoModelPicker";
import { OpenCodeGoOptionsFields } from "./opencode-go/OpenCodeGoOptionsFields";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ProviderRequestOptionsFields } from "./ProviderRequestOptionsFields";
import { usePresetEditorSelection } from "../hooks/usePresetEditorSelection";

type ProviderProfileForm = ProviderProfileInput & { api_key: string };

const emptyForm: ProviderProfileForm = {
  name: "",
  provider_type: "openrouter" as ProviderType,
  base_url: providerCapabilities.openrouter.defaultBaseUrl,
  model: "",
  models: [],
  api_key: "",
  temperature: 0.2,
  max_output_tokens: 4096,
  concurrency: providerCapabilities.openrouter.defaultConcurrency,
  timeout_seconds: 180,
  request_options: {
    top_p: null,
    seed: null,
    service_tier: null,
    reasoning_effort: null,
    prompt_cache_strategy: null,
  },
};

function profileToForm(profile: ProviderProfile): ProviderProfileForm {
  return {
    name: profile.name,
    provider_type: profile.provider_type,
    base_url: profile.base_url,
    model: profile.model,
    models: profile.models,
    api_key: "",
    temperature: profile.temperature,
    max_output_tokens: profile.max_output_tokens,
    concurrency: profile.concurrency,
    timeout_seconds: profile.timeout_seconds,
    request_options: profile.request_options,
  };
}

export function ProviderProfilesPanel({ createSignal }: { createSignal: number }) {
  const profiles = useProviderProfiles();
  const mutations = useProviderProfileMutations();
  const selection = usePresetEditorSelection(profiles.data, createSignal);
  const selected = selection.selected;
  const { confirmDiscard } = useUnsavedChangesGuard();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelDraft, setModelDraft] = useState("");

  useEffect(() => {
    setForm(selected ? profileToForm(selected) : emptyForm);
    setError(null);
    setShowModelPicker(false);
    setModelDraft("");
  }, [selected]);

  function setField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeProvider(provider_type: ProviderType) {
    const nextCapabilities = providerCapabilities[provider_type];
    setShowModelPicker(false);
    setForm((current) => {
      return {
        ...current,
        provider_type,
        base_url: nextCapabilities.defaultBaseUrl,
        model: "",
        models: [],
        api_key: "",
        concurrency: nextCapabilities.defaultConcurrency,
        request_options: {
          top_p: null,
          seed: null,
          service_tier: null,
          reasoning_effort: null,
          prompt_cache_strategy: null,
        },
      };
    });
  }

  function addModel(modelId: string, summary?: ProviderModelSummary) {
    const normalized = modelId.trim();
    if (!normalized) return;
    setForm((current) => {
      if (current.models.includes(normalized) || current.models.length >= 100) return current;
      const isFirst = current.models.length === 0;
      return {
        ...current,
        model: isFirst ? normalized : current.model,
        models: [...current.models, normalized],
        max_output_tokens:
          isFirst && summary?.max_output_tokens
            ? Math.min(current.max_output_tokens, summary.max_output_tokens)
            : current.max_output_tokens,
        request_options:
          isFirst &&
          current.request_options.reasoning_effort &&
          summary &&
          !summary.reasoning_efforts.includes(current.request_options.reasoning_effort)
            ? { ...current.request_options, reasoning_effort: null }
            : current.request_options,
      };
    });
    setModelDraft("");
  }

  function removeModel(modelId: string) {
    setForm((current) => {
      const models = current.models.filter((candidate) => candidate !== modelId);
      return {
        ...current,
        model: current.model === modelId ? (models[0] ?? "") : current.model,
        models,
      };
    });
  }

  function toggleCatalogModel(model: ProviderModelSummary) {
    if (form.models.includes(model.id)) {
      removeModel(model.id);
    } else {
      addModel(model.id, model);
    }
  }

  async function save() {
    setError(null);
    const changedProvider = Boolean(selected && selected.provider_type !== form.provider_type);
    const input = {
      ...form,
      api_key: form.api_key || (changedProvider ? "" : undefined),
    };
    try {
      if (selected) {
        await mutations.update.mutateAsync({ id: selected.id, input });
      } else {
        const created = await mutations.create.mutateAsync(input);
        selection.select(created.id);
      }
      setField("api_key", "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存模型连接。");
    }
  }

  async function remove() {
    if (!selected) return;
    const confirmed = await confirmDialog(`删除模型连接“${selected.name}”？`, {
      title: "删除模型连接",
      tone: "danger",
      confirmLabel: "删除",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await mutations.remove.mutateAsync(selected.id);
      selection.clear();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除模型连接。");
    }
  }

  async function clearApiKey() {
    if (!selected?.has_api_key) return;
    const confirmed = await confirmDialog("清除这个 API 配置中已保存的 API Key？", {
      title: "清除 API Key",
      tone: "danger",
      confirmLabel: "清除",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await mutations.update.mutateAsync({ id: selected.id, input: { api_key: "" } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法清除 API Key。");
    }
  }

  const pending =
    mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending;
  const capabilities = providerCapabilities[form.provider_type];
  const hasMatchingSavedApiKey = Boolean(
    selected?.has_api_key && selected.provider_type === form.provider_type,
  );
  const canSave = Boolean(
    form.name.trim() &&
    form.model.trim() &&
    form.models.length &&
    (!capabilities.requiresBaseUrl || form.base_url.trim()),
  );
  const baseline = selected ? profileToForm(selected) : emptyForm;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useUnsavedScope("provider-profile", dirty);

  return (
    <section className="preset-workarea">
      <aside className="preset-list">
        <header>
          <span className="eyebrow">Model connections</span>
          <strong>{profiles.data?.length ?? 0} 套配置</strong>
        </header>
        <div>
          {profiles.data?.map((profile) => (
            <button
              key={profile.id}
              className={
                !selection.isCreating && selection.selectedId === profile.id ? "is-active" : ""
              }
              onClick={() => {
                if (selection.selectedId === profile.id && !selection.isCreating) return;
                void confirmDiscard().then((confirmed) => {
                  if (confirmed) selection.select(profile.id);
                });
              }}
            >
              <Cable size={15} />
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {profile.models.length} 个模型 · 默认 {profile.model}
                </small>
              </span>
              {profile.has_api_key ? <KeyRound size={12} /> : null}
            </button>
          ))}
          {!profiles.data?.length ? <p>还没有保存模型连接。</p> : null}
        </div>
      </aside>
      <div className="preset-editor preset-editor--provider">
        <header>
          <div>
            <span className="eyebrow">{selected ? "Edit connection" : "New connection"}</span>
            <h1>{selected ? selected.name : "新的模型连接"}</h1>
          </div>
          <div>
            <Button
              tone="danger"
              icon={<Trash2 size={14} />}
              disabled={!selected || pending}
              onClick={() => void remove()}
            >
              删除
            </Button>
            <Button
              tone="primary"
              icon={pending ? <Spinner /> : <Save size={14} />}
              disabled={!canSave || !dirty || pending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        </header>
        <div className="form-grid">
          <label className="form-field">
            <span>配置名称</span>
            <input
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder={
                form.provider_type === "opencode_go"
                  ? "我的 OpenCode Go"
                  : capabilities.authMode === "codex_oauth"
                    ? "我的 Codex"
                    : "我的 OpenRouter"
              }
            />
          </label>
          <label className="form-field">
            <span>供应商协议</span>
            <select
              value={form.provider_type}
              onChange={(event) => changeProvider(event.target.value as ProviderType)}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="openai_compatible">OpenAI 兼容</option>
              <option value="opencode_go">OpenCode Go</option>
              <option value="gemini">Gemini 原生</option>
              <option value="codex">Codex · ChatGPT OAuth</option>
            </select>
          </label>
          {capabilities.authMode === "codex_oauth" ? <CodexConnectionPanel /> : null}
          {capabilities.requiresBaseUrl ? (
            <label className="form-field form-field--wide">
              <span>API 地址</span>
              <input
                value={form.base_url}
                onChange={(event) => setField("base_url", event.target.value)}
              />
            </label>
          ) : null}
          <div className="form-field form-field--wide">
            <span>添加模型</span>
            <div className="model-input-row">
              <input
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addModel(modelDraft);
                }}
                placeholder="输入模型 ID 后添加"
              />
              <Button
                type="button"
                icon={<Plus size={13} />}
                disabled={
                  !modelDraft.trim() ||
                  form.models.includes(modelDraft.trim()) ||
                  form.models.length >= 100
                }
                onClick={() => addModel(modelDraft)}
              >
                添加
              </Button>
              {capabilities.modelCatalog ? (
                <Button
                  type="button"
                  icon={<Search size={13} />}
                  onClick={() => setShowModelPicker((current) => !current)}
                >
                  {capabilities.modelCatalog === "openrouter" ? "搜索模型" : "选择模型"}
                </Button>
              ) : null}
            </div>
            <small className="provider-option-note">
              默认模型会在创建任务时自动选中；温度、输出长度等生成参数由本连接内所有模型共享。
            </small>
          </div>
          <div className="provider-model-list form-field--wide">
            <header>
              <span>已保存模型</span>
              <small>{form.models.length} / 100</small>
            </header>
            <div>
              {form.models.map((model) => (
                <div key={model} className={form.model === model ? "is-default" : ""}>
                  <button
                    type="button"
                    className="provider-model-list__default"
                    aria-pressed={form.model === model}
                    onClick={() => setField("model", model)}
                  >
                    <Star size={13} fill={form.model === model ? "currentColor" : "none"} />
                    <span>
                      <code>{model}</code>
                      <small>{form.model === model ? "默认模型" : "设为默认"}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="provider-model-list__remove"
                    aria-label={`移除模型 ${model}`}
                    onClick={() => removeModel(model)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {!form.models.length ? <p>请至少添加一个模型。</p> : null}
            </div>
          </div>
          {showModelPicker && capabilities.modelCatalog ? (
            capabilities.modelCatalog === "opencode_go" ? (
              <OpenCodeGoModelPicker
                baseUrl={form.base_url}
                profileId={selected?.id}
                apiKey={form.api_key}
                selectedModels={form.models}
                onToggle={toggleCatalogModel}
                onClose={() => setShowModelPicker(false)}
              />
            ) : (
              <ProviderModelPicker
                providerType={form.provider_type}
                baseUrl={form.base_url}
                profileId={selected?.id}
                apiKey={form.api_key}
                selectedModels={form.models}
                onToggle={toggleCatalogModel}
                onClose={() => setShowModelPicker(false)}
              />
            )
          ) : null}
          {capabilities.authMode === "api_key" ? (
            <>
              <div className="form-field form-field--wide">
                <span>API Key {hasMatchingSavedApiKey ? "· 已安全保存，留空保持不变" : ""}</span>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(event) => setField("api_key", event.target.value)}
                  placeholder={hasMatchingSavedApiKey ? "••••••••••••" : "输入 API Key"}
                />
                {hasMatchingSavedApiKey ? (
                  <Button
                    type="button"
                    tone="danger"
                    disabled={pending}
                    onClick={() => void clearApiKey()}
                  >
                    清除已保存的 Key
                  </Button>
                ) : null}
              </div>
              {form.provider_type !== "opencode_go" ? (
                <>
                  <label className="form-field">
                    <span>温度</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={form.temperature}
                      onChange={(event) => setField("temperature", Number(event.target.value))}
                    />
                  </label>
                  <label className="form-field">
                    <span>最大输出长度</span>
                    <input
                      type="number"
                      min="1"
                      value={form.max_output_tokens}
                      onChange={(event) =>
                        setField("max_output_tokens", Number(event.target.value))
                      }
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <label className="form-field">
            <span>并发数</span>
            <input
              type="number"
              min="1"
              max="64"
              value={form.concurrency}
              onChange={(event) => setField("concurrency", Number(event.target.value))}
            />
          </label>
          <label className="form-field">
            <span>超时（秒）</span>
            <input
              type="number"
              min="1"
              value={form.timeout_seconds}
              onChange={(event) => setField("timeout_seconds", Number(event.target.value))}
            />
          </label>
          {form.provider_type === "opencode_go" ? (
            <OpenCodeGoOptionsFields
              baseUrl={form.base_url}
              profileId={selected?.id}
              apiKey={form.api_key}
              model={form.model}
              temperature={form.temperature}
              maxOutputTokens={form.max_output_tokens}
              requestOptions={form.request_options}
              onTemperatureChange={(temperature) => setField("temperature", temperature)}
              onMaxOutputTokensChange={(max_output_tokens) =>
                setField("max_output_tokens", max_output_tokens)
              }
              onRequestOptionsChange={(request_options) =>
                setField("request_options", request_options)
              }
            />
          ) : (
            <ProviderRequestOptionsFields
              providerType={form.provider_type}
              value={form.request_options}
              onChange={(request_options) => setField("request_options", request_options)}
            />
          )}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}
