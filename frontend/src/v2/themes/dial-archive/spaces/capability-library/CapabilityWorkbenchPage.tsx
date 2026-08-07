import type { CapabilitySpaceContent } from "../../../../pages/spaces/spacePageModel";
import { CapabilityEditorSurface } from "../capability/CapabilityEditorSurface";

interface CapabilityWorkbenchPageProps {
  content: CapabilitySpaceContent;
}

const DISTRICT_PRESENTATION = {
  providers: { code: "PVD", label: "模型连接", english: "Provider Gateway" },
  taggers: { code: "TAG", label: "本地打标", english: "Local Taggers" },
  dictionaries: { code: "DIC", label: "Tag 词典", english: "Tag Dictionaries" },
  prompts: { code: "PRM", label: "Prompt 协议", english: "Prompt Protocols" },
} as const;

const EDITOR_PRESENTATION = {
  provider: { code: "CON", label: "连接与逐模型参数", section: "CONNECTION / MODELS / AUTH" },
  prompt: { code: "DOC", label: "协议文档", section: "IDENTITY / DOCUMENT BODY" },
  "tagger-runtime": { code: "RUN", label: "本地推理运行时", section: "ROOT / DEVICES / SCAN" },
  "tagger-installation": {
    code: "MDL",
    label: "模型安装档案",
    section: "FILES / INTEGRITY / PROFILE LINKS",
  },
  "tagger-profile": {
    code: "PRF",
    label: "模型执行配置",
    section: "MODEL / SELECTION / THRESHOLDS / RUNTIME",
  },
  dictionary: {
    code: "STK",
    label: "词典安装与优先级",
    section: "SOURCE / LICENSE / PRIORITY",
  },
  "dictionary-overrides": {
    code: "OVR",
    label: "全局词条修正",
    section: "SEARCH / RESOLUTION / OVERRIDE",
  },
} as const;

const LEVEL_THREE_EDITORS = new Set(["tagger-runtime", "dictionary-overrides"]);

export function CapabilityWorkbenchPage({ content }: CapabilityWorkbenchPageProps) {
  const object = content.activeObject;
  const editor = content.activeEditor;
  const district = content.activeDistrictId
    ? DISTRICT_PRESENTATION[content.activeDistrictId]
    : null;
  const editorPresentation = editor ? EDITOR_PRESENTATION[editor.kind] : null;
  const isModule = editor ? LEVEL_THREE_EDITORS.has(editor.kind) : false;
  const level = isModule ? "03 MODULE" : "04 OBJECT";

  return (
    <section
      className="dial-archive-capability-workbench"
      data-status={content.status}
      data-editor={editor?.kind ?? "missing"}
      data-level={isModule ? "module" : "object"}
      aria-labelledby="capability-workbench-title"
    >
      <div className="dial-archive-capability-workbench__grid" aria-hidden="true" />
      <div className="dial-archive-capability-workbench__word" aria-hidden="true">
        {editorPresentation?.code ?? district?.code ?? "CAP"}
      </div>

      <header className="dial-archive-capability-workbench__header">
        <button type="button" onClick={content.closeObject}>
          <span aria-hidden="true">←</span>
          <small>{district?.code ?? "CAP"} // PARENT</small>
          <strong>返回{district?.label ?? "能力分类"}</strong>
        </button>
        <div className="dial-archive-capability-workbench__title">
          <span>
            SPACE 06 // LEVEL {level} // {district?.code ?? "CAP"}.
            {editorPresentation?.code ?? "00"}
          </span>
          <h1 id="capability-workbench-title">
            {object?.name ?? editorPresentation?.label ?? "能力对象不可用"}
          </h1>
          <p>{object?.summary ?? "当前路由未匹配到仍然存在的能力对象。"}</p>
        </div>
        <div className="dial-archive-capability-workbench__status">
          <small>{object?.englishName ?? district?.english ?? "CAPABILITY"}</small>
          <strong data-tone={object?.status}>{object?.statusLabel ?? "NOT RESOLVED"}</strong>
          <button type="button" onClick={content.refresh} aria-label="刷新当前能力对象">
            ↻
          </button>
        </div>
        <b>{editorPresentation?.code ?? "L04"}</b>
      </header>

      <section className="dial-archive-capability-workbench__objectbar" aria-label="对象摘要">
        <div className="dial-archive-capability-workbench__object-id">
          <span>OBJECT</span>
          <strong>{object?.code ?? "GLOBAL"}</strong>
        </div>
        <div className="dial-archive-capability-workbench__readings">
          {(object?.readings ?? []).slice(0, 6).map((reading) => (
            <dl key={`${reading.label}-${reading.value}`} data-tone={reading.tone}>
              <dt>{reading.label}</dt>
              <dd>{reading.value}</dd>
            </dl>
          ))}
          {!object?.readings.length ? (
            <dl>
              <dt>EDITOR SCOPE</dt>
              <dd>{editorPresentation?.section ?? "OBJECT RESOLUTION"}</dd>
            </dl>
          ) : null}
        </div>
        <small>
          {object?.updatedAt ? `UPDATED // ${object.updatedAt}` : editorPresentation?.section}
        </small>
      </section>

      <main className="dial-archive-capability-workbench__canvas">
        {editor ? (
          <CapabilityEditorSurface editor={editor} onDirtyChange={content.setEditorDirty} />
        ) : (
          <div className="dial-archive-capability-workbench__missing" role="status">
            <span>{content.status === "loading" ? "SYNCING OBJECT" : "OBJECT NOT AVAILABLE"}</span>
            <strong>
              {content.status === "loading" ? "正在读取能力档案" : "对象可能已被删除或路由已经失效"}
            </strong>
            <p>{content.message ?? "返回上一级工作面重新选择一个有效对象。"}</p>
            <button type="button" onClick={content.closeObject}>
              返回上一级工作面
            </button>
          </div>
        )}
      </main>

      <footer className="dial-archive-capability-workbench__footer">
        <span>{district?.english.toUpperCase() ?? "CAPABILITY"}</span>
        <span>{editorPresentation?.section ?? "OBJECT RESOLUTION"}</span>
        <b>{isModule ? "DOMAIN MODULE" : "SCOPED OBJECT EDITOR"}</b>
      </footer>
    </section>
  );
}
