import type { AnnotationEditContent } from "../../../../../../pages/spaces/spacePageModel";
import { AnnotationEditTagSurface } from "./AnnotationEditTagSurface";
import { AnnotationEditTextSurface } from "./AnnotationEditTextSurface";

interface AnnotationEditTranslationSurfaceProps {
  edit: AnnotationEditContent;
}

export function AnnotationEditTranslationSurface({ edit }: AnnotationEditTranslationSurfaceProps) {
  const translation = edit.translation;
  const targetReadOnly = translation.readOnly || !translation.editing;

  return (
    <section className="dial-archive-edit-translation" aria-label="翻译对照工作面">
      <header className="dial-archive-edit-translation__controls">
        <div>
          <span>TRANSLATION PROTOCOL</span>
          <b>{translation.statusLabel}</b>
        </div>
        <label>
          <span>PRODUCER</span>
          <select
            value={translation.producerKind}
            disabled={edit.writePending}
            onChange={(event) =>
              translation.setProducerKind(event.target.value as "llm" | "local_dictionary")
            }
          >
            <option value="llm">LLM 翻译</option>
            <option value="local_dictionary">本地 Tag 词典</option>
          </select>
        </label>
        <label>
          <span>SOURCE</span>
          <select
            value={translation.sourceKind}
            disabled={translation.producerKind === "local_dictionary" || edit.writePending}
            onChange={(event) =>
              translation.setSourceKind(event.target.value as "description" | "tags")
            }
          >
            <option value="description">LLM 描述</option>
            <option value="tags">Tags</option>
          </select>
        </label>
        <label>
          <span>LANGUAGE</span>
          <select
            value={translation.language}
            disabled={edit.writePending}
            onChange={(event) => translation.setLanguage(event.target.value)}
          >
            {translation.languageOptions.map((language) => (
              <option value={language} key={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="dial-archive-edit-translation__compare">
        <section className="dial-archive-edit-translation__source">
          <header>
            <span>SOURCE // {translation.sourceKind.toUpperCase()}</span>
            <b>源标注证据</b>
            <em>{translation.sourceExists ? "SOURCE LOCKED" : "SOURCE MISSING"}</em>
          </header>
          {translation.sourceKind === "tags" ? (
            <AnnotationEditTagSurface model={edit.tags} compact />
          ) : (
            <pre>{translation.sourceContent || "当前素材尚未建立可用的描述源。"}</pre>
          )}
        </section>

        <div className="dial-archive-edit-translation__axis" aria-hidden="true">
          <span>SOURCE</span>
          <i />
          <b>→</b>
          <i />
          <span>TARGET</span>
        </div>

        <section className="dial-archive-edit-translation__target">
          <AnnotationEditTextSurface
            edit={edit}
            code={`TRN.${translation.language.toUpperCase()}`}
            title="目标译文"
            readOnly={targetReadOnly}
          />
        </section>
      </div>

      <footer>
        <span>ALIGNMENT // {translation.alignmentStatus.toUpperCase()}</span>
        <span>OVERRIDE {translation.dictionaryOverrideCount}</span>
        <span>UNMATCHED {translation.dictionaryUnmatchedCount}</span>
        {translation.issue ? <strong>{translation.issue}</strong> : null}
        {translation.qualityIssues[0] ? <strong>{translation.qualityIssues[0]}</strong> : null}
      </footer>
    </section>
  );
}
