import { useEffect, useMemo, useRef, type ClipboardEvent, type MouseEvent } from "react";

import type {
  AnnotationEditContent,
  AnnotationEditTranslationPart,
} from "../../../../../../pages/spaces/spacePageModel";
import { AnnotationEditTextSurface } from "./AnnotationEditTextSurface";
import {
  useAlignedTranslationScroll,
  type TranslationAlignmentSide,
} from "./useAlignedTranslationScroll";

interface AnnotationEditTranslationSurfaceProps {
  edit: AnnotationEditContent;
}

interface AlignedReadingProps {
  parts: readonly AnnotationEditTranslationPart[];
  side: "source" | "target";
  activeIds: ReadonlySet<string>;
  onHover(id: string | null): void;
  onPin(ids: readonly string[]): void;
  onActivateSide(side: TranslationAlignmentSide): void;
}

function plainCopy(event: ClipboardEvent<HTMLElement>) {
  const selected = window.getSelection()?.toString();
  if (!selected) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", selected);
}

function selectedAlignmentIds(root: HTMLElement): string[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return [];
  const range = selection.getRangeAt(0);
  return Array.from(root.querySelectorAll<HTMLElement>("[data-alignment-id]"))
    .filter((element) => {
      try {
        return range.intersectsNode(element);
      } catch {
        return false;
      }
    })
    .map((element) => element.dataset.alignmentId ?? "")
    .filter(Boolean);
}

function AlignedReading({
  parts,
  side,
  activeIds,
  onHover,
  onPin,
  onActivateSide,
}: AlignedReadingProps) {
  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    const ids = selectedAlignmentIds(event.currentTarget);
    if (ids.length) {
      onActivateSide(side);
      onPin(ids);
    }
  };
  return (
    <div
      className={`dial-archive-edit-translation__aligned is-${parts[0]?.kind ?? "segment"}`}
      onCopy={plainCopy}
      onMouseUp={handleMouseUp}
    >
      {parts.map((part) => (
        <span
          className={activeIds.has(part.id) ? "is-active" : undefined}
          data-alignment-id={part.id}
          data-category={part.category ?? undefined}
          tabIndex={0}
          onMouseEnter={() => {
            onActivateSide(side);
            onHover(part.id);
          }}
          onMouseLeave={() => onHover(null)}
          onFocus={() => {
            onActivateSide(side);
            onHover(part.id);
          }}
          onBlur={() => onHover(null)}
          onClick={() => {
            onActivateSide(side);
            onPin([part.id]);
          }}
          key={part.id}
        >
          {side === "source" ? part.sourceText : part.translatedText || "∅"}
        </span>
      ))}
    </div>
  );
}

export function AnnotationEditTranslationSurface({ edit }: AnnotationEditTranslationSurfaceProps) {
  const translation = edit.translation;
  const comparison = edit.translationComparison;
  const sourceRef = useRef<HTMLElement>(null);
  const targetRef = useRef<HTMLElement>(null);
  const synchronizingRef = useRef(false);
  const activeIds = useMemo(() => new Set(comparison.activeIds), [comparison.activeIds]);
  const targetReadOnly = translation.readOnly || !translation.editing;
  const alignmentLayoutKey = useMemo(
    () =>
      comparison.parts
        .map(
          (part) =>
            `${part.id}:${part.sourceText.length}:${part.translatedText.length}:${part.kind}`,
        )
        .join("\u0000"),
    [comparison.parts],
  );
  const activateAlignmentSide = useAlignedTranslationScroll({
    sourceRootRef: sourceRef,
    targetRootRef: targetRef,
    alignmentIds: comparison.activeIds,
    layoutKey: alignmentLayoutKey,
    enabled: comparison.aligned && comparison.sourceMode === "segments" && !translation.editing,
  });

  useEffect(() => {
    const source = sourceRef.current?.querySelector<HTMLElement>(
      ":scope > .dial-archive-edit-translation__aligned, :scope > pre",
    );
    const target = targetRef.current?.querySelector<HTMLElement>(
      ":scope > .dial-archive-edit-translation__aligned, :scope > pre",
    );
    if (!source || !target || translation.editing || comparison.sourceMode === "segments") {
      return;
    }
    const synchronize = (from: HTMLElement, to: HTMLElement) => {
      if (synchronizingRef.current) return;
      const fromRange = from.scrollHeight - from.clientHeight;
      const toRange = to.scrollHeight - to.clientHeight;
      if (fromRange <= 0 || toRange <= 0) return;
      synchronizingRef.current = true;
      to.scrollTop = (from.scrollTop / fromRange) * toRange;
      window.requestAnimationFrame(() => {
        synchronizingRef.current = false;
      });
    };
    const fromSource = () => synchronize(source, target);
    const fromTarget = () => synchronize(target, source);
    source.addEventListener("scroll", fromSource, { passive: true });
    target.addEventListener("scroll", fromTarget, { passive: true });
    return () => {
      source.removeEventListener("scroll", fromSource);
      target.removeEventListener("scroll", fromTarget);
    };
  }, [comparison.parts, comparison.sourceMode, translation.editing]);

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
        <section className="dial-archive-edit-translation__source" ref={sourceRef}>
          <header>
            <span>SOURCE // {translation.sourceKind.toUpperCase()}</span>
            <b>源标注证据</b>
            <em>{translation.sourceExists ? "SOURCE LOCKED" : "SOURCE MISSING"}</em>
          </header>
          {comparison.aligned && comparison.parts.length ? (
            <AlignedReading
              parts={comparison.parts}
              side="source"
              activeIds={activeIds}
              onHover={comparison.setHover}
              onPin={comparison.pin}
              onActivateSide={activateAlignmentSide}
            />
          ) : (
            <pre onCopy={plainCopy}>
              {comparison.sourceText || "当前素材尚未建立可用的描述源。"}
            </pre>
          )}
        </section>

        <div className="dial-archive-edit-translation__axis" aria-hidden="true">
          <span>SOURCE</span>
          <i />
          <b>→</b>
          <i />
          <span>TARGET</span>
        </div>

        <section className="dial-archive-edit-translation__target" ref={targetRef}>
          {translation.editing ? (
            <AnnotationEditTextSurface
              edit={edit}
              code={`TRN.${translation.language.toUpperCase()}`}
              title="目标译文"
              readOnly={targetReadOnly}
            />
          ) : comparison.aligned && comparison.parts.length ? (
            <>
              <header>
                <span>TARGET // {translation.language.toUpperCase()}</span>
                <b>目标译文</b>
                <em>{comparison.pinned ? "ALIGNMENT PINNED" : "LIVE ALIGNMENT"}</em>
              </header>
              <AlignedReading
                parts={comparison.parts}
                side="target"
                activeIds={activeIds}
                onHover={comparison.setHover}
                onPin={comparison.pin}
                onActivateSide={activateAlignmentSide}
              />
            </>
          ) : (
            <>
              <header>
                <span>TARGET // {translation.language.toUpperCase()}</span>
                <b>目标译文</b>
                <em>PLAIN READING</em>
              </header>
              <pre onCopy={plainCopy}>{comparison.translatedText || "当前尚无可读译文。"}</pre>
            </>
          )}
        </section>
      </div>

      <footer>
        <span>ALIGNMENT // {translation.alignmentStatus.toUpperCase()}</span>
        <span>OVERRIDE {translation.dictionaryOverrideCount}</span>
        <span>UNMATCHED {translation.dictionaryUnmatchedCount}</span>
        {comparison.dictionaryState !== "idle" ? (
          <span>DICTIONARY // {comparison.dictionaryState.toUpperCase()}</span>
        ) : null}
        {comparison.pinned ? (
          <button type="button" onClick={comparison.clearPin}>
            CLEAR ALIGNMENT PIN
          </button>
        ) : null}
        {comparison.dictionaryMessage ? <span>{comparison.dictionaryMessage}</span> : null}
        {translation.issue ? <strong>{translation.issue}</strong> : null}
        {translation.qualityIssues[0] ? <strong>{translation.qualityIssues[0]}</strong> : null}
      </footer>
    </section>
  );
}
