import { useEffect, useState } from "react";
import { Languages, Save, Trash2 } from "lucide-react";

import {
  useTranslationPromptPresetMutations,
  useTranslationPromptPresets,
} from "../../../features/presets/hooks";
import { useUnsavedChangesGuard, useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { usePresetEditorSelection } from "../hooks/usePresetEditorSelection";

export function TranslationPromptsPanel({ createSignal }: { createSignal: number }) {
  const presets = useTranslationPromptPresets();
  const mutations = useTranslationPromptPresetMutations();
  const selection = usePresetEditorSelection(presets.data, createSignal);
  const selected = selection.selected;
  const { confirmDiscard } = useUnsavedChangesGuard();
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
        const created = await mutations.create.mutateAsync({
          name,
          system_prompt: prompt,
        });
        selection.select(created.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存翻译 Prompt 预设。");
    }
  }

  async function remove() {
    if (!selected) return;
    const confirmed = await confirmDialog(`删除翻译 Prompt 预设“${selected.name}”？`, {
      title: "删除翻译 Prompt",
      tone: "danger",
      confirmLabel: "删除",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await mutations.remove.mutateAsync(selected.id);
      selection.clear();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除翻译 Prompt 预设。");
    }
  }

  const dirty = selected
    ? name !== selected.name || prompt !== selected.system_prompt
    : name !== "" || prompt !== "";
  const canSave = Boolean(name.trim() && prompt.trim());
  useUnsavedScope("translation-prompt-preset", dirty);
  const pending =
    mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending;

  return (
    <section className="preset-workarea">
      <aside className="preset-list">
        <header>
          <span className="eyebrow">Translation Prompt</span>
          <strong>{presets.data?.length ?? 0} 套预设</strong>
        </header>
        <div>
          {presets.data?.map((preset) => (
            <button
              key={preset.id}
              className={
                !selection.isCreating && selection.selectedId === preset.id ? "is-active" : ""
              }
              onClick={() => {
                if (selection.selectedId === preset.id && !selection.isCreating) return;
                void confirmDiscard().then((confirmed) => {
                  if (confirmed) selection.select(preset.id);
                });
              }}
            >
              <Languages size={15} />
              <span>
                <strong>{preset.name}</strong>
                <small>{preset.system_prompt.slice(0, 70)}</small>
              </span>
            </button>
          ))}
          {!presets.data?.length ? <p>还没有翻译 Prompt 预设。</p> : null}
        </div>
      </aside>
      <div className="preset-editor preset-editor--translation">
        <header>
          <div>
            <span className="eyebrow">{selected ? "Edit preset" : "New preset"}</span>
            <h1>{selected ? selected.name : "新的翻译 Prompt"}</h1>
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
              disabled={!dirty || !canSave || pending}
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
            placeholder="例如：简洁中文翻译"
          />
        </label>
        <div className="preset-template-hint">
          <strong>可用变量</strong>
          <code>{"{target_language}"}</code>
          <code>{"{language_code}"}</code>
          <small>源标注由任务作为只读 User Prompt 注入，不需要写进此模板。</small>
        </div>
        <label className="form-field form-field--grow">
          <span>System Prompt 模板</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入翻译任务使用的 System Prompt…"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}
