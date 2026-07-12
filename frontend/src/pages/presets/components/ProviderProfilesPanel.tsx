import { useEffect, useState } from "react";
import { Cable, KeyRound, Save, Search, Trash2 } from "lucide-react";

import type { ProviderProfileInput } from "../../../features/presets/api";
import { useProviderProfileMutations, useProviderProfiles } from "../../../features/presets/hooks";
import type { ProviderType } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ProviderRequestOptionsFields } from "./ProviderRequestOptionsFields";
import { usePresetEditorSelection } from "../hooks/usePresetEditorSelection";

const defaultUrls: Record<ProviderType, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai_compatible: "http://127.0.0.1:8000/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

type ProviderProfileForm = ProviderProfileInput & { api_key: string };

const emptyForm: ProviderProfileForm = {
  name: "",
  provider_type: "openrouter" as ProviderType,
  base_url: defaultUrls.openrouter,
  model: "",
  api_key: "",
  temperature: 0.2,
  max_output_tokens: 4096,
  concurrency: 4,
  timeout_seconds: 180,
  request_options: {
    top_p: null,
    seed: null,
    service_tier: null,
    reasoning_effort: null,
  },
};

export function ProviderProfilesPanel({ createSignal }: { createSignal: number }) {
  const profiles = useProviderProfiles();
  const mutations = useProviderProfileMutations();
  const selection = usePresetEditorSelection(profiles.data, createSignal);
  const selected = selection.selected;
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    setForm(selected ? { ...selected, api_key: "" } : emptyForm);
    setError(null);
    setShowModelPicker(false);
  }, [selected]);

  function setField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeProvider(provider_type: ProviderType) {
    setForm((current) => ({ ...current, provider_type, base_url: defaultUrls[provider_type] }));
  }

  async function save() {
    setError(null);
    const input = { ...form, api_key: form.api_key || undefined };
    try {
      if (selected) {
        await mutations.update.mutateAsync({ id: selected.id, input });
      } else {
        const created = await mutations.create.mutateAsync(input);
        selection.select(created.id);
      }
      setField("api_key", "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存 API 配置。 ");
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`删除 API 配置“${selected.name}”？`)) return;
    await mutations.remove.mutateAsync(selected.id);
    selection.clear();
  }

  const pending = mutations.create.isPending || mutations.update.isPending;
  const canSave = Boolean(form.name.trim() && form.base_url.trim() && form.model.trim());

  return (
    <section className="preset-workarea">
      <aside className="preset-list">
        <header>
          <span className="eyebrow">API connections</span>
          <strong>{profiles.data?.length ?? 0} 套配置</strong>
        </header>
        <div>
          {profiles.data?.map((profile) => (
            <button
              key={profile.id}
              className={
                !selection.isCreating && selection.selectedId === profile.id ? "is-active" : ""
              }
              onClick={() => selection.select(profile.id)}
            >
              <Cable size={15} />
              <span>
                <strong>{profile.name}</strong>
                <small>{profile.model}</small>
              </span>
              {profile.has_api_key ? <KeyRound size={12} /> : null}
            </button>
          ))}
          {!profiles.data?.length ? <p>还没有保存 API 配置。</p> : null}
        </div>
      </aside>
      <div className="preset-editor preset-editor--provider">
        <header>
          <div>
            <span className="eyebrow">{selected ? "Edit connection" : "New connection"}</span>
            <h1>{selected ? selected.name : "新的 API 配置"}</h1>
          </div>
          <div>
            <Button
              tone="danger"
              icon={<Trash2 size={14} />}
              disabled={!selected || mutations.remove.isPending}
              onClick={() => void remove()}
            >
              删除
            </Button>
            <Button
              tone="primary"
              icon={pending ? <Spinner /> : <Save size={14} />}
              disabled={!canSave || pending}
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
              placeholder="我的 OpenRouter"
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
              <option value="gemini">Gemini 原生</option>
            </select>
          </label>
          <label className="form-field form-field--wide">
            <span>API 地址</span>
            <input
              value={form.base_url}
              onChange={(event) => setField("base_url", event.target.value)}
            />
          </label>
          <div className="form-field form-field--wide">
            <span>默认模型</span>
            <div className="model-input-row">
              <input
                value={form.model}
                onChange={(event) => setField("model", event.target.value)}
                placeholder="模型 ID"
              />
              {form.provider_type === "openrouter" ? (
                <Button
                  type="button"
                  icon={<Search size={13} />}
                  onClick={() => setShowModelPicker((current) => !current)}
                >
                  搜索模型
                </Button>
              ) : null}
            </div>
          </div>
          {showModelPicker && form.provider_type === "openrouter" ? (
            <ProviderModelPicker
              providerType={form.provider_type}
              baseUrl={form.base_url}
              profileId={selected?.id}
              apiKey={form.api_key}
              selectedModel={form.model}
              onSelect={(model) => {
                setField("model", model.id);
                setShowModelPicker(false);
              }}
              onClose={() => setShowModelPicker(false)}
            />
          ) : null}
          <label className="form-field form-field--wide">
            <span>API Key {selected?.has_api_key ? "· 已安全保存，留空保持不变" : ""}</span>
            <input
              type="password"
              value={form.api_key}
              onChange={(event) => setField("api_key", event.target.value)}
              placeholder={selected?.has_api_key ? "••••••••••••" : "输入 API Key"}
            />
          </label>
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
              onChange={(event) => setField("max_output_tokens", Number(event.target.value))}
            />
          </label>
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
          <ProviderRequestOptionsFields
            providerType={form.provider_type}
            value={form.request_options}
            onChange={(request_options) => setField("request_options", request_options)}
          />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}
