import { useEffect, useState } from "react";
import { FileText, Save, Trash2 } from "lucide-react";

import { useSystemPresetMutations, useSystemPresets } from "../../../features/presets/hooks";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { usePresetEditorSelection } from "../hooks/usePresetEditorSelection";

export function SystemPresetsPanel({ createSignal }: { createSignal: number }) {
  const presets = useSystemPresets();
  const mutations = useSystemPresetMutations();
  const selection = usePresetEditorSelection(presets.data, createSignal);
  const selected = selection.selected;
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(selected?.name ?? "");
    setPrompt(selected?.system_prompt ?? "");
    setError(null);
  }, [selected]);

  async function save() {
    setError(null);
    try {
      if (selected) {
        await mutations.update.mutateAsync({
          id: selected.id,
          input: { name, system_prompt: prompt },
        });
      } else {
        const created = await mutations.create.mutateAsync({ name, system_prompt: prompt });
        selection.select(created.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存预设。 ");
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`删除全局预设“${selected.name}”？`)) return;
    await mutations.remove.mutateAsync(selected.id);
    selection.clear();
  }

  const dirty = Boolean(
    name.trim() && prompt && (name !== selected?.name || prompt !== selected?.system_prompt),
  );
  const pending = mutations.create.isPending || mutations.update.isPending;

  return (
    <section className="preset-workarea">
      <aside className="preset-list">
        <header>
          <span className="eyebrow">System Prompt</span>
          <strong>{presets.data?.length ?? 0} 套预设</strong>
        </header>
        <div>
          {presets.data?.map((preset) => (
            <button
              key={preset.id}
              className={
                !selection.isCreating && selection.selectedId === preset.id ? "is-active" : ""
              }
              onClick={() => selection.select(preset.id)}
            >
              <FileText size={15} />
              <span>
                <strong>{preset.name}</strong>
                <small>{preset.system_prompt.slice(0, 70)}</small>
              </span>
            </button>
          ))}
          {!presets.data?.length ? <p>还没有全局 System Prompt 预设。</p> : null}
        </div>
      </aside>
      <div className="preset-editor">
        <header>
          <div>
            <span className="eyebrow">{selected ? "Edit preset" : "New preset"}</span>
            <h1>{selected ? selected.name : "新的 System Prompt"}</h1>
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
              disabled={!dirty || pending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        </header>
        <label className="form-field">
          <span>预设名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：Krea 结构化描述"
          />
        </label>
        <label className="form-field form-field--grow">
          <span>System Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入发送给模型的完整 System Prompt…"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}
