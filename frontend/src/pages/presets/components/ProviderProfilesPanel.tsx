import { useEffect, useMemo, useState } from "react";
import { Cable, KeyRound, Save, Trash2 } from "lucide-react";

import { useProviderProfileMutations, useProviderProfiles } from "../../../features/presets/hooks";
import type { ProviderType } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

const defaultUrls: Record<ProviderType, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai_compatible: "http://127.0.0.1:8000/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const emptyForm = {
  name: "",
  provider_type: "openrouter" as ProviderType,
  base_url: defaultUrls.openrouter,
  model: "",
  api_key: "",
  temperature: 0.2,
  max_output_tokens: 4096,
  concurrency: 4,
  timeout_seconds: 180,
};

export function ProviderProfilesPanel({ createSignal }: { createSignal: number }) {
  const profiles = useProviderProfiles();
  const mutations = useProviderProfileMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => profiles.data?.find((profile) => profile.id === selectedId) ?? null,
    [profiles.data, selectedId],
  );
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && profiles.data?.length) setSelectedId(profiles.data[0].id);
  }, [profiles.data, selectedId]);

  useEffect(() => {
    setForm(selected ? { ...selected, api_key: "" } : emptyForm);
    setError(null);
  }, [selected]);

  useEffect(() => {
    if (createSignal > 0) {
      setSelectedId(null);
      setForm(emptyForm);
      setError(null);
    }
  }, [createSignal]);

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
        setSelectedId(created.id);
      }
      setField("api_key", "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存 API 配置。 ");
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`删除 API 配置“${selected.name}”？`)) return;
    await mutations.remove.mutateAsync(selected.id);
    setSelectedId(null);
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
              className={selectedId === profile.id ? "is-active" : ""}
              onClick={() => setSelectedId(profile.id)}
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
          <label className="form-field form-field--wide">
            <span>默认模型</span>
            <input
              value={form.model}
              onChange={(event) => setField("model", event.target.value)}
              placeholder="模型 ID"
            />
          </label>
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
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}
