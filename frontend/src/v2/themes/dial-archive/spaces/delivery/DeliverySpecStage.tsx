import type { DeliveryWorkbenchContent } from "../../../../pages/spaces/spacePageModel";

type DeliverySelection = DeliveryWorkbenchContent["form"]["selections"][number];
type DeliveryChannel = DeliverySelection["channel"];
type DeliveryFormat = DeliveryWorkbenchContent["form"]["formats"][number];

interface DeliverySpecStageProps {
  content: DeliveryWorkbenchContent;
}

const BASE_CHANNELS: readonly {
  id: Exclude<DeliveryChannel, "translation">;
  code: string;
  label: string;
}[] = [
  { id: "existing_annotation", code: "LEG.00", label: "原有标注" },
  { id: "tags", code: "TAG.01", label: "Tags" },
  { id: "description", code: "DSC.02", label: "LLM 描述" },
];

const DEFAULT_TRANSLATION_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko"];

export function DeliverySpecStage({ content }: DeliverySpecStageProps) {
  const form = content.form;

  const updateSelection = (index: number, update: Partial<DeliverySelection>) => {
    content.updateForm({
      selections: form.selections.map((selection, current) =>
        current === index ? { ...selection, ...update } : selection,
      ),
    });
  };

  const toggleBaseChannel = (channel: Exclude<DeliveryChannel, "translation">) => {
    const selected = form.selections.some((selection) => selection.channel === channel);
    content.updateForm({
      selections: selected
        ? form.selections.filter((selection) => selection.channel !== channel)
        : [...form.selections, { channel, language: "", revision: "current" }],
    });
  };

  const addTranslation = () => {
    const selectedLanguages = new Set(
      form.selections
        .filter((selection) => selection.channel === "translation")
        .map((selection) => selection.language.toLowerCase()),
    );
    const language =
      DEFAULT_TRANSLATION_LANGUAGES.find(
        (candidate) => !selectedLanguages.has(candidate.toLowerCase()),
      ) ?? "";
    content.updateForm({
      selections: [
        ...form.selections,
        {
          channel: "translation",
          language,
          translation_source_kind: "description",
          translation_producer_kind: "llm",
          revision: "current",
        },
      ],
    });
  };

  const removeSelection = (index: number) => {
    content.updateForm({
      selections: form.selections.filter((_, current) => current !== index),
    });
  };

  const toggleFormat = (format: DeliveryFormat) => {
    content.updateForm({
      formats: form.formats.includes(format)
        ? form.formats.filter((candidate) => candidate !== format)
        : [...form.formats, format],
    });
  };

  return (
    <section className="dial-archive-delivery-spec" aria-labelledby="delivery-spec-title">
      <aside className="dial-archive-delivery-spec__index" aria-hidden="true">
        <span>01</span>
        <b>SPEC</b>
        <i />
        <em>ASSEMBLY</em>
      </aside>

      <div className="dial-archive-delivery-spec__sheet">
        <header>
          <span>01 / MANIFEST SPECIFICATION</span>
          <h1 id="delivery-spec-title">方案编组</h1>
          <p>确认实际范围、通道修订、输出结构与外部目的地。</p>
        </header>

        <section
          className="dial-archive-delivery-spec__scope"
          aria-labelledby="delivery-scope-title"
        >
          <header>
            <span>01.1</span>
            <h2 id="delivery-scope-title">交付范围</h2>
          </header>
          <div role="group" aria-label="交付范围">
            <button
              type="button"
              className={form.scope === "all" ? "is-active" : undefined}
              aria-pressed={form.scope === "all"}
              onClick={() => content.updateForm({ scope: "all" })}
            >
              <span>ALL</span>
              <b>当前项目</b>
              <em>{content.assetCount} 张素材</em>
            </button>
            <button
              type="button"
              className={form.scope === "selected" ? "is-active" : undefined}
              aria-pressed={form.scope === "selected"}
              onClick={() => content.updateForm({ scope: "selected" })}
            >
              <span>SELECTED</span>
              <b>工作台已选</b>
              <em>{content.checkedCount} 张素材</em>
            </button>
          </div>
        </section>

        <section
          className="dial-archive-delivery-spec__channels"
          aria-labelledby="delivery-channels-title"
        >
          <header>
            <span>01.2</span>
            <h2 id="delivery-channels-title">通道与修订</h2>
            <button type="button" onClick={addTranslation}>
              + 添加译文
            </button>
          </header>

          <div className="dial-archive-delivery-spec__base-channels">
            {BASE_CHANNELS.map((channel) => {
              const selected = form.selections.some(
                (selection) => selection.channel === channel.id,
              );
              return (
                <button
                  type="button"
                  className={selected ? "is-active" : undefined}
                  aria-pressed={selected}
                  onClick={() => toggleBaseChannel(channel.id)}
                  key={channel.id}
                >
                  <span>{channel.code}</span>
                  <b>{channel.label}</b>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <div className="dial-archive-delivery-spec__channel-register">
            {form.selections.map((selection, index) => (
              <article key={`${selection.channel}:${index}`}>
                <span className="dial-archive-delivery-spec__channel-code">
                  {selection.channel === "translation"
                    ? `TRN.${String(index + 1).padStart(2, "0")}`
                    : BASE_CHANNELS.find((channel) => channel.id === selection.channel)?.code}
                </span>
                <strong>
                  {selection.channel === "translation"
                    ? `译文 / ${selection.language || "LANG?"}`
                    : BASE_CHANNELS.find((channel) => channel.id === selection.channel)?.label}
                </strong>
                {selection.channel === "translation" ? (
                  <>
                    <label>
                      <span>来源</span>
                      <select
                        aria-label={`译文来源 ${index + 1}`}
                        value={selection.translation_source_kind ?? "description"}
                        onChange={(event) =>
                          updateSelection(index, {
                            translation_source_kind: event.target
                              .value as DeliverySelection["translation_source_kind"],
                            translation_producer_kind:
                              event.target.value === "description"
                                ? "llm"
                                : selection.translation_producer_kind,
                          })
                        }
                      >
                        <option value="description">LLM 描述</option>
                        <option value="tags">Tags</option>
                      </select>
                    </label>
                    <label>
                      <span>生成</span>
                      <select
                        aria-label={`译文生成方式 ${index + 1}`}
                        value={selection.translation_producer_kind ?? "llm"}
                        onChange={(event) =>
                          updateSelection(index, {
                            translation_producer_kind: event.target
                              .value as DeliverySelection["translation_producer_kind"],
                            translation_source_kind:
                              event.target.value === "local_dictionary"
                                ? "tags"
                                : selection.translation_source_kind,
                          })
                        }
                      >
                        <option value="llm">LLM</option>
                        <option value="local_dictionary">本地词典</option>
                      </select>
                    </label>
                    <label>
                      <span>语言</span>
                      <input
                        aria-label={`译文语言 ${index + 1}`}
                        value={selection.language}
                        placeholder="zh-CN"
                        onChange={(event) =>
                          updateSelection(index, { language: event.target.value })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <span className="dial-archive-delivery-spec__channel-detail">
                    单独形成交付清单项
                  </span>
                )}
                <label className="dial-archive-delivery-spec__revision">
                  <span>修订</span>
                  <select
                    aria-label={`${selection.channel} 修订策略`}
                    value={selection.revision}
                    onChange={(event) =>
                      updateSelection(index, {
                        revision: event.target.value as DeliverySelection["revision"],
                      })
                    }
                  >
                    <option value="current">当前版本</option>
                    <option value="reviewed">已人工复核版本</option>
                  </select>
                </label>
                {selection.channel === "translation" ? (
                  <button
                    className="dial-archive-delivery-spec__remove"
                    type="button"
                    aria-label={`移除译文 ${selection.language || index + 1}`}
                    onClick={() => removeSelection(index)}
                  >
                    ×
                  </button>
                ) : null}
              </article>
            ))}
            {!form.selections.length ? <p>至少选择一个标注通道。</p> : null}
          </div>
        </section>

        <section
          className="dial-archive-delivery-spec__output"
          aria-labelledby="delivery-output-title"
        >
          <header>
            <span>01.3</span>
            <h2 id="delivery-output-title">输出结构</h2>
          </header>
          <div>
            <span>FORMAT //</span>
            {(["txt", "json"] as const).map((format) => (
              <button
                type="button"
                className={form.formats.includes(format) ? "is-active" : undefined}
                aria-pressed={form.formats.includes(format)}
                onClick={() => toggleFormat(format)}
                key={format}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          <div>
            <span>PACKAGE //</span>
            <button
              type="button"
              className={form.packaging === "directory" ? "is-active" : undefined}
              aria-pressed={form.packaging === "directory"}
              onClick={() => content.updateForm({ packaging: "directory" })}
            >
              文件夹
            </button>
            <button
              type="button"
              className={form.packaging === "zip" ? "is-active" : undefined}
              aria-pressed={form.packaging === "zip"}
              onClick={() => content.updateForm({ packaging: "zip" })}
            >
              ZIP
            </button>
          </div>
        </section>
      </div>

      <aside className="dial-archive-delivery-spec__destination">
        <header>
          <span>DESTINATION // EXTERNAL</span>
          <h2>出站目的地</h2>
        </header>
        <div className="dial-archive-delivery-spec__destination-path">
          <span>{form.packaging === "zip" ? "ARCHIVE TARGET" : "DIRECTORY TARGET"}</span>
          <b title={form.destinationPath}>{form.destinationPath || "尚未选择外部目录"}</b>
        </div>
        <button type="button" onClick={() => void content.chooseDestination()}>
          选择目录 <span>BROWSE ↗</span>
        </button>
        <dl>
          <div>
            <dt>IMAGE</dt>
            <dd>复制原始字节</dd>
          </div>
          <div>
            <dt>REVISION</dt>
            <dd>预检冻结实际修订</dd>
          </div>
          <div>
            <dt>OVERWRITE</dt>
            <dd>保留现有文件</dd>
          </div>
        </dl>
        {form.scope === "selected" && content.checkedCount === 0 ? (
          <p className="is-warning">工作台当前没有已选素材。</p>
        ) : null}
        {content.error ? <p className="is-error">{content.error}</p> : null}
        <button
          className="dial-archive-delivery-spec__preview"
          type="button"
          disabled={!content.canPreview || content.previewPending || content.exportPending}
          onClick={() => void content.previewAction()}
        >
          <span>
            <b>{content.previewPending ? "正在生成预检" : "生成预检"}</b>
            <small>冻结范围、修订与目标输出</small>
          </span>
          <em>PREFLIGHT →</em>
        </button>
      </aside>
    </section>
  );
}
