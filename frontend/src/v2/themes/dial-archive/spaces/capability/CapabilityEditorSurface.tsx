import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  CapabilityDictionaryEditor,
  CapabilityDictionaryOverridesEditor,
  CapabilityObjectEditor,
  CapabilityPromptEditor,
  CapabilityProviderDraft,
  CapabilityProviderEditor,
  CapabilityProviderModelDraft,
  CapabilityTaggerInstallationEditor,
  CapabilityTaggerProfileDraft,
  CapabilityTaggerProfileEditor,
  CapabilityTaggerRuntimeEditor,
} from "../../../../pages/spaces/spacePageModel";

interface CapabilityEditorSurfaceProps {
  editor: CapabilityObjectEditor;
  onDirtyChange(dirty: boolean): void;
}

interface FeedbackState {
  busy: boolean;
  message: string | null;
  error: string | null;
}

function useFeedback() {
  const [feedback, setFeedback] = useState<FeedbackState>({
    busy: false,
    message: null,
    error: null,
  });
  const run = async (action: () => Promise<void>, message: string): Promise<boolean> => {
    setFeedback({ busy: true, message: null, error: null });
    try {
      await action();
      setFeedback({ busy: false, message, error: null });
      return true;
    } catch (reason) {
      setFeedback({
        busy: false,
        message: null,
        error: reason instanceof Error ? reason.message : "能力操作失败。",
      });
      return false;
    }
  };
  return { feedback, run };
}

function Feedback({ state }: { state: FeedbackState }) {
  if (!state.message && !state.error) return null;
  return (
    <p
      className="dial-archive-capability-editor__feedback"
      data-tone={state.error ? "error" : "ok"}
    >
      {state.error ?? state.message}
    </p>
  );
}

function DangerAction({
  disabled,
  label,
  confirmLabel,
  onConfirm,
}: {
  disabled: boolean;
  label: string;
  confirmLabel: string;
  onConfirm(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      className="is-danger"
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        onConfirm();
      }}
      onBlur={() => setConfirming(false)}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`dial-archive-capability-editor__field${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ProviderEditor({
  editor,
  onDirtyChange,
}: {
  editor: CapabilityProviderEditor;
  onDirtyChange(dirty: boolean): void;
}) {
  const [baseline, setBaseline] = useState(() => editor.form);
  const [draft, setDraft] = useState<CapabilityProviderDraft>(() => ({
    ...editor.form,
    models: editor.form.models.map((model) => ({ ...model })),
  }));
  const [selectedModelId, setSelectedModelId] = useState(
    editor.form.defaultModelId || editor.form.models[0]?.modelId || "",
  );
  const [modelDraft, setModelDraft] = useState("");
  const { feedback, run } = useFeedback();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const protocol = editor.protocols.find((candidate) => candidate.id === draft.providerType);
  const selectedModel = draft.models.find((model) => model.modelId === selectedModelId);
  const busy = editor.pending || feedback.busy;
  const valid = Boolean(
    draft.name.trim() &&
    draft.models.length &&
    draft.models.some((model) => model.modelId === draft.defaultModelId) &&
    draft.concurrency >= 1 &&
    draft.concurrency <= 64 &&
    (!protocol?.requiresBaseUrl || draft.baseUrl.trim()),
  );

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const setField = <K extends keyof CapabilityProviderDraft>(
    field: K,
    value: CapabilityProviderDraft[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));

  const updateModel = (next: CapabilityProviderModelDraft) => {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) => (model.modelId === next.modelId ? next : model)),
    }));
  };

  const addModel = () => {
    const modelId = modelDraft.trim();
    if (!modelId || draft.models.some((model) => model.modelId === modelId)) return;
    const model: CapabilityProviderModelDraft = {
      modelId,
      temperature: draft.providerType === "codex" ? null : 0.2,
      maxOutputTokens: 4096,
      timeoutSeconds: 180,
      topP: null,
      seed: null,
      reasoningEffort: null,
      serviceTier: null,
      promptCacheStrategy: null,
    };
    setDraft((current) => ({
      ...current,
      defaultModelId: current.defaultModelId || modelId,
      models: [...current.models, model],
    }));
    setSelectedModelId(modelId);
    setModelDraft("");
  };

  const removeModel = (modelId: string) => {
    setDraft((current) => {
      const models = current.models.filter((model) => model.modelId !== modelId);
      return {
        ...current,
        models,
        defaultModelId:
          current.defaultModelId === modelId ? (models[0]?.modelId ?? "") : current.defaultModelId,
      };
    });
    if (selectedModelId === modelId) setSelectedModelId("");
  };

  return (
    <section className="dial-archive-capability-editor" data-editor="provider">
      <header>
        <span>LIVE CONFIGURATION</span>
        <strong>模型连接编辑</strong>
        <p>连接、认证、模型清单与逐模型参数会写回共享能力库。</p>
      </header>
      <div className="dial-archive-capability-editor__grid">
        <Field label="配置名称">
          <input value={draft.name} onChange={(event) => setField("name", event.target.value)} />
        </Field>
        <Field label="供应商协议">
          <select
            value={draft.providerType}
            onChange={(event) => {
              const next = editor.protocols.find((option) => option.id === event.target.value);
              if (!next) return;
              setDraft((current) => ({
                ...current,
                providerType: next.id,
                baseUrl: next.defaultBaseUrl,
                concurrency: next.defaultConcurrency,
              }));
            }}
          >
            {editor.protocols.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {protocol?.requiresBaseUrl ? (
          <Field label="API 地址" wide>
            <input
              value={draft.baseUrl}
              onChange={(event) => setField("baseUrl", event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="连接总并发">
          <input
            type="number"
            min="1"
            max="64"
            value={draft.concurrency}
            onChange={(event) => setField("concurrency", Number(event.target.value))}
          />
        </Field>
        {protocol?.authentication === "api-key" ? (
          <Field label={`API Key${editor.hasApiKey ? " · 已保存，留空保持" : ""}`}>
            <input
              type="password"
              value={draft.apiKey}
              placeholder={editor.hasApiKey ? "••••••••••••" : "输入 API Key"}
              onChange={(event) => setField("apiKey", event.target.value)}
            />
          </Field>
        ) : (
          <div className="dial-archive-capability-editor__notice">
            CODEX ACCOUNT / 账户认证状态由本机会话管理
          </div>
        )}
      </div>

      <section className="dial-archive-capability-editor__module">
        <header>
          <span>MODEL INDEX</span>
          <em>{draft.models.length.toString().padStart(2, "0")}</em>
        </header>
        <div className="dial-archive-capability-editor__add-row">
          <input
            value={modelDraft}
            placeholder="输入模型 ID"
            onChange={(event) => setModelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addModel();
              }
            }}
          />
          <button type="button" disabled={!modelDraft.trim()} onClick={addModel}>
            + ADD MODEL
          </button>
        </div>
        <div className="dial-archive-capability-editor__model-list">
          {draft.models.map((model) => (
            <div
              className={model.modelId === selectedModelId ? "is-active" : undefined}
              key={model.modelId}
            >
              <button type="button" onClick={() => setSelectedModelId(model.modelId)}>
                <strong>{model.modelId}</strong>
                <small>{model.modelId === draft.defaultModelId ? "DEFAULT" : "CONFIGURE"}</small>
              </button>
              <button
                type="button"
                aria-label={`将 ${model.modelId} 设为默认模型`}
                onClick={() => setField("defaultModelId", model.modelId)}
              >
                {model.modelId === draft.defaultModelId ? "★" : "☆"}
              </button>
              <button
                type="button"
                aria-label={`移除 ${model.modelId}`}
                onClick={() => removeModel(model.modelId)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {selectedModel ? (
        <section className="dial-archive-capability-editor__module">
          <header>
            <span>MODEL PARAMETERS</span>
            <em>{selectedModel.modelId}</em>
          </header>
          <div className="dial-archive-capability-editor__grid">
            {draft.providerType !== "codex" ? (
              <>
                <Field label="温度">
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={selectedModel.temperature ?? ""}
                    placeholder="不发送"
                    onChange={(event) =>
                      updateModel({
                        ...selectedModel,
                        temperature: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="最大输出 Token">
                  <input
                    type="number"
                    min="1"
                    value={selectedModel.maxOutputTokens}
                    onChange={(event) =>
                      updateModel({ ...selectedModel, maxOutputTokens: Number(event.target.value) })
                    }
                  />
                </Field>
              </>
            ) : null}
            <Field label="超时（秒）">
              <input
                type="number"
                min="1"
                max="3600"
                value={selectedModel.timeoutSeconds}
                onChange={(event) =>
                  updateModel({ ...selectedModel, timeoutSeconds: Number(event.target.value) })
                }
              />
            </Field>
            {draft.providerType !== "gemini" ? (
              <Field label="推理强度">
                <select
                  value={selectedModel.reasoningEffort ?? ""}
                  onChange={(event) =>
                    updateModel({
                      ...selectedModel,
                      reasoningEffort:
                        (event.target.value as CapabilityProviderModelDraft["reasoningEffort"]) ||
                        null,
                    })
                  }
                >
                  <option value="">模型默认</option>
                  {["max", "xhigh", "high", "medium", "low", "minimal", "none"].map((effort) => (
                    <option value={effort} key={effort}>
                      {effort.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {draft.providerType !== "codex" && draft.providerType !== "opencode_go" ? (
              <>
                <Field label="Top P">
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedModel.topP ?? ""}
                    placeholder="不发送"
                    onChange={(event) =>
                      updateModel({
                        ...selectedModel,
                        topP: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="随机种子">
                  <input
                    type="number"
                    min="0"
                    value={selectedModel.seed ?? ""}
                    placeholder="不发送"
                    onChange={(event) =>
                      updateModel({
                        ...selectedModel,
                        seed: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </>
            ) : null}
            {draft.providerType === "openrouter" ? (
              <>
                <Field label="服务等级">
                  <select
                    value={selectedModel.serviceTier ?? ""}
                    onChange={(event) =>
                      updateModel({
                        ...selectedModel,
                        serviceTier: (event.target.value as "flex" | "priority") || null,
                      })
                    }
                  >
                    <option value="">默认</option>
                    <option value="flex">FLEX</option>
                    <option value="priority">PRIORITY</option>
                  </select>
                </Field>
                <Field label="提示词缓存">
                  <select
                    value={selectedModel.promptCacheStrategy ?? ""}
                    onChange={(event) =>
                      updateModel({
                        ...selectedModel,
                        promptCacheStrategy: event.target.value ? "explicit_system" : null,
                      })
                    }
                  >
                    <option value="">关闭</option>
                    <option value="explicit_system">SYSTEM 断点</option>
                  </select>
                </Field>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="dial-archive-capability-editor__actions">
        <DangerAction
          disabled={busy}
          label="DELETE CONNECTION"
          confirmLabel="CONFIRM DELETE"
          onConfirm={() => void run(editor.remove, "模型连接已删除。")}
        />
        {editor.hasApiKey && protocol?.authentication === "api-key" ? (
          <DangerAction
            disabled={busy}
            label="CLEAR API KEY"
            confirmLabel="CONFIRM CLEAR"
            onConfirm={() => void run(editor.clearApiKey, "API Key 已清除。")}
          />
        ) : null}
        <button
          className="is-primary"
          type="button"
          disabled={!dirty || !valid || busy}
          onClick={() =>
            void run(async () => {
              await editor.save(draft);
              const saved = { ...draft, apiKey: "" };
              setDraft(saved);
              setBaseline(saved);
            }, "模型连接已保存。")
          }
        >
          {busy ? "SAVING…" : "SAVE CONNECTION"}
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function PromptEditor({
  editor,
  onDirtyChange,
}: {
  editor: CapabilityPromptEditor;
  onDirtyChange(dirty: boolean): void;
}) {
  const [baseline, setBaseline] = useState(editor.form);
  const [name, setName] = useState(editor.form.name);
  const [prompt, setPrompt] = useState(editor.form.prompt);
  const { feedback, run } = useFeedback();
  const dirty = name !== baseline.name || prompt !== baseline.prompt;
  const busy = editor.pending || feedback.busy;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  return (
    <section className="dial-archive-capability-editor" data-editor="prompt">
      <header>
        <span>{editor.promptKind === "system" ? "SYSTEM PROTOCOL" : "TRANSLATION PROTOCOL"}</span>
        <strong>提示词正文编辑</strong>
        <p>保存后由所有引用此预设的生产线路共享。</p>
      </header>
      <Field label="预设名称" wide>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {editor.promptKind === "translation" ? (
        <div className="dial-archive-capability-editor__notice">
          AVAILABLE VARIABLES&nbsp;&nbsp; {"{target_language}"}&nbsp;&nbsp; {"{language_code}"}
        </div>
      ) : null}
      <Field label="System Prompt" wide>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </Field>
      <footer className="dial-archive-capability-editor__actions">
        <DangerAction
          disabled={busy}
          label="DELETE PRESET"
          confirmLabel="CONFIRM DELETE"
          onConfirm={() => void run(editor.remove, "提示词预设已删除。")}
        />
        <button
          className="is-primary"
          type="button"
          disabled={!dirty || !name.trim() || !prompt.trim() || busy}
          onClick={() =>
            void run(async () => {
              await editor.save({ name, prompt });
              setBaseline({ name, prompt });
            }, "提示词预设已保存。")
          }
        >
          {busy ? "SAVING…" : "SAVE DOCUMENT"}
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function RuntimeEditor({ editor }: { editor: CapabilityTaggerRuntimeEditor }) {
  const { feedback, run } = useFeedback();
  const busy = editor.pending || feedback.busy;
  return (
    <section className="dial-archive-capability-editor" data-editor="runtime">
      <header>
        <span>LOCAL INFERENCE CONTROL</span>
        <strong>运行时与模型库</strong>
        <p>扫描、导入与模型库位置操作直接作用于本机共享运行时。</p>
      </header>
      <div className="dial-archive-capability-editor__path-readout">
        <span>MODEL ROOT</span>
        <code>{editor.modelRoot}</code>
      </div>
      <div className="dial-archive-capability-editor__chips">
        {[...editor.devices, ...editor.providers].map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
      {editor.scanIssues.map((issue) => (
        <p className="dial-archive-capability-editor__warning" key={issue}>
          {issue}
        </p>
      ))}
      <footer className="dial-archive-capability-editor__actions is-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.openRoot, "已打开模型库目录。")}
        >
          OPEN FOLDER
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.chooseRoot, "模型库位置已更新。")}
        >
          CHANGE ROOT
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.rescan, "模型库扫描完成。")}
        >
          RESCAN
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={busy}
          onClick={() => void run(editor.importModel, "本地模型已导入。")}
        >
          IMPORT MODEL
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function InstallationEditor({ editor }: { editor: CapabilityTaggerInstallationEditor }) {
  const { feedback, run } = useFeedback();
  const busy = editor.pending || feedback.busy;
  return (
    <section className="dial-archive-capability-editor" data-editor="installation">
      <header>
        <span>MANAGED INSTALLATION</span>
        <strong>模型安装管理</strong>
        <p>{editor.linkedProfileCount} 个 Profile 与此模型关联。</p>
      </header>
      <div className="dial-archive-capability-editor__path-readout">
        <span>LOCAL PATH</span>
        <code>{editor.path}</code>
      </div>
      {editor.issues.map((issue) => (
        <p className="dial-archive-capability-editor__warning" key={issue}>
          {issue}
        </p>
      ))}
      <section className="dial-archive-capability-editor__module">
        <header>
          <span>FILE MANIFEST</span>
          <em>{editor.files.length.toString().padStart(2, "0")}</em>
        </header>
        <div className="dial-archive-capability-editor__file-list">
          {editor.files.map((file) => (
            <div key={file.path}>
              <code>{file.path}</code>
              <span>{file.size}</span>
            </div>
          ))}
        </div>
      </section>
      <footer className="dial-archive-capability-editor__actions is-wrap">
        <DangerAction
          disabled={busy}
          label="DELETE MODEL"
          confirmLabel={`DELETE + ${editor.linkedProfileCount} PROFILES`}
          onConfirm={() => void run(editor.remove, "模型安装已删除。")}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.openFolder, "已打开模型目录。")}
        >
          OPEN FILES
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.validate, "模型完整性校验完成。")}
        >
          VALIDATE
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={busy || !editor.ready}
          onClick={() => void run(editor.createProfile, "已创建新的打标配置。")}
        >
          + NEW PROFILE
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function TaggerProfileEditor({
  editor,
  onDirtyChange,
}: {
  editor: CapabilityTaggerProfileEditor;
  onDirtyChange(dirty: boolean): void;
}) {
  const [baseline, setBaseline] = useState(editor.form);
  const [draft, setDraft] = useState<CapabilityTaggerProfileDraft>(() => ({
    ...editor.form,
    categoryThresholds: { ...editor.form.categoryThresholds },
    categories: [...editor.form.categories],
  }));
  const { feedback, run } = useFeedback();
  const installation = editor.installations.find(
    (candidate) => candidate.id === draft.installationId,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const busy = editor.pending || feedback.busy;
  const valid = Boolean(
    draft.name.trim() &&
    installation &&
    draft.categories.length &&
    draft.globalThreshold >= 0.01 &&
    draft.globalThreshold <= 0.99 &&
    (draft.batchSize === null || (draft.batchSize >= 1 && draft.batchSize <= 32)),
  );
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const setField = <K extends keyof CapabilityTaggerProfileDraft>(
    field: K,
    value: CapabilityTaggerProfileDraft[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));
  return (
    <section className="dial-archive-capability-editor" data-editor="tagger-profile">
      <header>
        <span>EXECUTION PROFILE</span>
        <strong>打标配置编辑</strong>
        <p>策略、阈值、类别与设备独立于模型安装保存。</p>
      </header>
      <div className="dial-archive-capability-editor__grid">
        <Field label="配置名称" wide>
          <input value={draft.name} onChange={(event) => setField("name", event.target.value)} />
        </Field>
        <Field label="模型安装" wide>
          <select
            value={draft.installationId}
            onChange={(event) => setField("installationId", event.target.value)}
          >
            {editor.installations.map((option) => (
              <option value={option.id} key={option.id}>
                {option.name} · {option.modelVersion}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标签选择策略">
          <select
            value={draft.selectionMode}
            onChange={(event) =>
              setField(
                "selectionMode",
                event.target.value as CapabilityTaggerProfileDraft["selectionMode"],
              )
            }
          >
            {(installation?.supportedSelectionModes ?? []).map((mode) => (
              <option value={mode} key={mode}>
                {mode.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="全局 / 回退阈值">
          <input
            type="number"
            min="0.01"
            max="0.99"
            step="0.01"
            value={draft.globalThreshold}
            onChange={(event) => setField("globalThreshold", Number(event.target.value))}
          />
        </Field>
        <Field label="最大标签数">
          <input
            type="number"
            min="1"
            value={draft.maxTags ?? ""}
            placeholder="不限制"
            onChange={(event) =>
              setField("maxTags", event.target.value === "" ? null : Number(event.target.value))
            }
          />
        </Field>
        <Field label="推理批大小">
          <input
            type="number"
            min="1"
            max="32"
            value={draft.batchSize ?? ""}
            placeholder="自动"
            onChange={(event) =>
              setField("batchSize", event.target.value === "" ? null : Number(event.target.value))
            }
          />
        </Field>
        <Field label="执行设备" wide>
          <select
            value={draft.device}
            onChange={(event) =>
              setField("device", event.target.value as CapabilityTaggerProfileDraft["device"])
            }
          >
            {Array.from(new Set([...editor.availableDevices, draft.device])).map((device) => (
              <option value={device} key={device}>
                {device.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {draft.selectionMode !== "global" ? (
        <section className="dial-archive-capability-editor__module">
          <header>
            <span>CATEGORY THRESHOLDS</span>
            <em>0.01—0.99</em>
          </header>
          <div className="dial-archive-capability-editor__thresholds">
            {Object.keys(installation?.categories ?? {}).map((category) => (
              <Field label={category} key={category}>
                <input
                  type="number"
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  value={draft.categoryThresholds[category] ?? draft.globalThreshold}
                  onChange={(event) =>
                    setField("categoryThresholds", {
                      ...draft.categoryThresholds,
                      [category]: Number(event.target.value),
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </section>
      ) : null}
      <section className="dial-archive-capability-editor__module">
        <header>
          <span>OUTPUT CATEGORIES</span>
          <em>{draft.categories.length}</em>
        </header>
        <div className="dial-archive-capability-editor__checks">
          {Object.entries(installation?.categories ?? {}).map(([category, count]) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={draft.categories.includes(category)}
                onChange={() =>
                  setField(
                    "categories",
                    draft.categories.includes(category)
                      ? draft.categories.filter((item) => item !== category)
                      : [...draft.categories, category],
                  )
                }
              />
              <span>{category}</span>
              <small>{count.toLocaleString()}</small>
            </label>
          ))}
        </div>
      </section>
      <footer className="dial-archive-capability-editor__actions">
        <DangerAction
          disabled={busy}
          label="DELETE PROFILE"
          confirmLabel="CONFIRM DELETE"
          onConfirm={() => void run(editor.remove, "打标配置已删除。")}
        />
        <button
          className="is-primary"
          type="button"
          disabled={!dirty || !valid || busy}
          onClick={() =>
            void run(async () => {
              await editor.save(draft);
              setBaseline(draft);
            }, "打标配置已保存。")
          }
        >
          {busy ? "SAVING…" : "SAVE PROFILE"}
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function DictionaryEditor({
  editor,
  onDirtyChange,
}: {
  editor: CapabilityDictionaryEditor;
  onDirtyChange(dirty: boolean): void;
}) {
  const [baseline, setBaseline] = useState(editor.form);
  const [name, setName] = useState(editor.form.name);
  const [enabled, setEnabled] = useState(editor.form.enabled);
  const { feedback, run } = useFeedback();
  const dirty = name !== baseline.name || enabled !== baseline.enabled;
  const busy = editor.pending || feedback.busy;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  return (
    <section className="dial-archive-capability-editor" data-editor="dictionary">
      <header>
        <span>PRIORITY INSTALLATION</span>
        <strong>词典安装管理</strong>
        <p>名称、启用状态和查询优先级会影响所有项目的本地译文。</p>
      </header>
      <div className="dial-archive-capability-editor__grid">
        <Field label="显示名称">
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <label className="dial-archive-capability-editor__toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!editor.ready}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>参与查询</span>
        </label>
      </div>
      <div className="dial-archive-capability-editor__path-readout">
        <span>LOCAL PATH</span>
        <code>{editor.path}</code>
      </div>
      <section className="dial-archive-capability-editor__module">
        <header>
          <span>PRIORITY ORDER</span>
          <em>
            {String(editor.priority + 1).padStart(2, "0")} /{" "}
            {String(editor.installationCount).padStart(2, "0")}
          </em>
        </header>
        <div className="dial-archive-capability-editor__inline-actions">
          <button
            type="button"
            disabled={busy || editor.priority <= 0}
            onClick={() => void run(() => editor.move(-1), "词典优先级已上移。")}
          >
            ↑ MOVE UP
          </button>
          <button
            type="button"
            disabled={busy || editor.priority >= editor.installationCount - 1}
            onClick={() => void run(() => editor.move(1), "词典优先级已下移。")}
          >
            ↓ MOVE DOWN
          </button>
        </div>
      </section>
      <footer className="dial-archive-capability-editor__actions is-wrap">
        <DangerAction
          disabled={busy}
          label="DELETE DICTIONARY"
          confirmLabel="CONFIRM DELETE"
          onConfirm={() => void run(editor.remove, "词典安装已删除。")}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.openFolder, "已打开词典目录。")}
        >
          OPEN FILES
        </button>
        <button
          type="button"
          disabled={busy || !editor.licenseUrl}
          onClick={() => void run(editor.openLicense, "已打开授权说明。")}
        >
          LICENSE
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={!dirty || !name.trim() || busy}
          onClick={() =>
            void run(async () => {
              await editor.save({ name, enabled });
              setBaseline({ name, enabled });
            }, "词典设置已保存。")
          }
        >
          SAVE DICTIONARY
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

function DictionaryOverridesEditor({
  editor,
  onDirtyChange,
}: {
  editor: CapabilityDictionaryOverridesEditor;
  onDirtyChange(dirty: boolean): void;
}) {
  const [query, setQuery] = useState(editor.query);
  const [tag, setTag] = useState("");
  const [translation, setTranslation] = useState("");
  const [category, setCategory] = useState("");
  const { feedback, run } = useFeedback();
  const selected = useMemo(
    () =>
      editor.results.find(
        (item) => item.normalizedTag === tag.toLocaleLowerCase().trim().replace(/\s+/gu, "_"),
      ),
    [editor.results, tag],
  );
  const dirty = Boolean(tag || translation || category);
  const busy = editor.pending || feedback.busy;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const choose = (item: CapabilityDictionaryOverridesEditor["results"][number]) => {
    setTag(item.tag);
    setTranslation(item.translation);
    setCategory(item.category);
  };
  return (
    <section className="dial-archive-capability-editor" data-editor="overrides">
      <header>
        <span>EFFECTIVE LOOKUP</span>
        <strong>全局词条修正</strong>
        <p>词典文件保持只读；修正记录优先覆盖所有已启用词典。</p>
      </header>
      <div className="dial-archive-capability-editor__path-readout">
        <span>DICTIONARY LIBRARY</span>
        <code>{editor.dictionaryRoot || "UNRESOLVED"}</code>
      </div>
      <div className="dial-archive-capability-editor__inline-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.importFile, "本地词典文件已导入。")}
        >
          IMPORT FILE
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(editor.importFolder, "本地词典目录已导入。")}
        >
          IMPORT FOLDER
        </button>
        <button
          type="button"
          disabled={busy || !editor.dictionaryRoot}
          onClick={() => void run(editor.openRoot, "已打开词典库目录。")}
        >
          OPEN LIBRARY
        </button>
      </div>
      <div className="dial-archive-capability-editor__add-row">
        <input
          value={query}
          placeholder="Tag / 中文译文"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor.search(query.trim());
            }
          }}
        />
        <button type="button" disabled={!query.trim()} onClick={() => editor.search(query.trim())}>
          {editor.searching ? "SEARCHING…" : "SEARCH"}
        </button>
      </div>
      {editor.searchError ? (
        <p className="dial-archive-capability-editor__warning">{editor.searchError}</p>
      ) : null}
      <div className="dial-archive-capability-editor__search-results">
        {editor.results.map((item) => (
          <button
            type="button"
            className={selected?.normalizedTag === item.normalizedTag ? "is-active" : undefined}
            onClick={() => choose(item)}
            key={item.normalizedTag}
          >
            <strong>{item.tag}</strong>
            <span>{item.translation || "未命中"}</span>
            <small>{item.hasOverride ? "USER OVERRIDE" : item.source}</small>
          </button>
        ))}
      </div>
      <div className="dial-archive-capability-editor__grid">
        <Field label="原始 Tag" wide>
          <input value={tag} onChange={(event) => setTag(event.target.value)} />
        </Field>
        <Field label="简体中文译文" wide>
          <input value={translation} onChange={(event) => setTranslation(event.target.value)} />
        </Field>
        <Field label="类别（可选）" wide>
          <input value={category} onChange={(event) => setCategory(event.target.value)} />
        </Field>
      </div>
      <footer className="dial-archive-capability-editor__actions">
        <DangerAction
          disabled={busy || !selected?.hasOverride}
          label="DELETE OVERRIDE"
          confirmLabel="CONFIRM DELETE"
          onConfirm={() =>
            void run(async () => {
              await editor.remove(selected?.tag ?? tag);
              setTranslation("");
            }, "修正词条已删除。")
          }
        />
        <button
          className="is-primary"
          type="button"
          disabled={busy || !tag.trim() || !translation.trim()}
          onClick={() =>
            void run(
              () => editor.save({ tag, translation, category: category || null }),
              "修正词条已保存。",
            )
          }
        >
          SAVE OVERRIDE
        </button>
      </footer>
      <Feedback state={feedback} />
    </section>
  );
}

export function CapabilityEditorSurface({ editor, onDirtyChange }: CapabilityEditorSurfaceProps) {
  if (editor.kind === "provider")
    return <ProviderEditor editor={editor} onDirtyChange={onDirtyChange} />;
  if (editor.kind === "prompt")
    return <PromptEditor editor={editor} onDirtyChange={onDirtyChange} />;
  if (editor.kind === "tagger-runtime") return <RuntimeEditor editor={editor} />;
  if (editor.kind === "tagger-installation") return <InstallationEditor editor={editor} />;
  if (editor.kind === "tagger-profile")
    return <TaggerProfileEditor editor={editor} onDirtyChange={onDirtyChange} />;
  if (editor.kind === "dictionary")
    return <DictionaryEditor editor={editor} onDirtyChange={onDirtyChange} />;
  return <DictionaryOverridesEditor editor={editor} onDirtyChange={onDirtyChange} />;
}
