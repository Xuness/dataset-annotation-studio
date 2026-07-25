import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import CodeMirror from "@uiw/react-codemirror";

import type { TranslationAlignmentPart, TranslationDocument } from "../../../shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import { TRANSLATION_STATUS_LABELS } from "./annotationLabels";

interface TranslationComparePanelProps {
  translation: TranslationDocument | undefined;
  loading: boolean;
  error: unknown;
  editing: boolean;
  editContent: string;
  editorExtensions: NonNullable<ComponentProps<typeof CodeMirror>["extensions"]>;
  onEditContentChange: (content: string) => void;
}

type AlignmentSide = "source" | "translated";

function collectSelectedAlignmentIds(
  container: HTMLElement,
  selection: Selection | null,
): string[] {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (
    !container.contains(range.commonAncestorContainer) &&
    !container.contains(range.startContainer) &&
    !container.contains(range.endContainer)
  ) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>("[data-alignment-id]"))
    .filter((element) => {
      try {
        return range.intersectsNode(element);
      } catch {
        return false;
      }
    })
    .map((element) => element.dataset.alignmentId)
    .filter((value): value is string => Boolean(value));
}

function sourceLabel(document: TranslationDocument): string {
  if (document.source_kind === "tags") return "Tags";
  return document.resolved_source_channel === "existing_annotation" ? "原有标注" : "LLM 描述";
}

function categoryTone(category: string | null): string {
  if (category === "character") return "accent";
  if (category === "copyright") return "sage";
  if (category === "artist" || category === "quality" || category === "year") {
    return "warning";
  }
  if (category === "rating") return "danger";
  return "neutral";
}

export function TranslationComparePanel({
  translation,
  loading,
  error,
  editing,
  editContent,
  editorExtensions,
  onEditContentChange,
}: TranslationComparePanelProps) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const translatedRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const aligned =
    !editing && translation?.status === "current" && translation.alignment_status === "aligned";
  const activeIds = useMemo(
    () => new Set(pinnedIds.length ? pinnedIds : hoveredId ? [hoveredId] : []),
    [hoveredId, pinnedIds],
  );

  useEffect(() => {
    setHoveredId(null);
    setPinnedIds([]);
  }, [
    translation?.asset_id,
    translation?.language,
    translation?.source_kind,
    translation?.producer_kind,
    translation?.modified_at,
    editing,
  ]);

  useEffect(() => {
    function clearPinned(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPinnedIds([]);
    }
    window.addEventListener("keydown", clearPinned);
    return () => window.removeEventListener("keydown", clearPinned);
  }, []);

  function captureSelection(side: AlignmentSide) {
    if (!aligned) return;
    const container = side === "source" ? sourceRef.current : translatedRef.current;
    if (!container) return;
    const ids = collectSelectedAlignmentIds(container, window.getSelection());
    if (ids.length) {
      setPinnedIds(Array.from(new Set(ids)));
      setHoveredId(null);
    }
  }

  function handleKeyUp(side: AlignmentSide, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setPinnedIds([]);
      return;
    }
    captureSelection(side);
  }

  function renderAlignedParts(side: AlignmentSide, parts: TranslationAlignmentPart[]) {
    const isTags = translation?.source_kind === "tags";
    return (
      <div
        ref={side === "source" ? sourceRef : translatedRef}
        className={`translation-compare__aligned translation-compare__aligned--${
          isTags ? "tags" : "description"
        }`}
        onMouseUp={() => captureSelection(side)}
        onKeyUp={(event) => handleKeyUp(side, event)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setPinnedIds([]);
        }}
        tabIndex={0}
      >
        {parts.map((part) => {
          const value = side === "source" ? part.source_text : part.translated_text;
          const alignable = part.kind !== "structure";
          return (
            <span
              key={`${side}:${part.id}`}
              className={[
                "translation-compare__part",
                `translation-compare__part--${part.kind}`,
                activeIds.has(part.id) ? "is-linked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-alignment-id={alignable ? part.id : undefined}
              data-category-tone={part.kind === "tag" ? categoryTone(part.category) : undefined}
              onPointerEnter={() => {
                if (alignable && !pinnedIds.length) setHoveredId(part.id);
              }}
              onPointerLeave={() => {
                if (alignable && !pinnedIds.length) setHoveredId(null);
              }}
              title={
                isTags && part.category
                  ? `${part.category}${
                      part.confidence == null ? "" : ` · ${(part.confidence * 100).toFixed(1)}%`
                    }`
                  : undefined
              }
            >
              {value}
            </span>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="annotation-editor__empty">
        <Spinner label="读取译文对照" />
      </div>
    );
  }
  if (error && !translation) {
    return (
      <div className="annotation-editor__empty validation-warning">
        无法读取译文：{error instanceof Error ? error.message : "未知错误"}
      </div>
    );
  }

  const hasSource = Boolean(translation?.source_exists);
  const canRenderAligned = Boolean(aligned && translation?.alignment_parts.length);
  const sourceContent = translation?.source_content ?? "";
  const translatedContent = translation?.content ?? "";
  const mismatch = translation?.status === "source_mismatch";
  const dictionarySummary =
    translation?.producer_kind === "local_dictionary"
      ? [
          ...translation.dictionary_sources.map(
            (source) => `${source.name} ${source.matched_count} 项`,
          ),
          translation.dictionary_override_count
            ? `修正 ${translation.dictionary_override_count} 项`
            : "",
          translation.dictionary_unmatched_count
            ? `未命中 ${translation.dictionary_unmatched_count} 项`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  return (
    <div className="annotation-editor__compare translation-compare">
      <section>
        <header>
          <strong>{translation ? sourceLabel(translation) : "源标注"}</strong>
          <small>
            {translation?.source_revision_id
              ? `当前源 · ${translation.source_revision_id.slice(0, 8)}`
              : "缺失"}
          </small>
        </header>
        <div>
          {!hasSource ? (
            <div className="annotation-editor__empty">
              {translation?.issue ?? "当前没有可用的源标注。"}
            </div>
          ) : canRenderAligned ? (
            renderAlignedParts("source", translation!.alignment_parts)
          ) : (
            <pre className="translation-compare__plain">{sourceContent}</pre>
          )}
        </div>
      </section>

      <section>
        <header>
          <strong>{translation?.language ?? ""} 译文</strong>
          <small title={dictionarySummary || undefined}>
            {translation ? TRANSLATION_STATUS_LABELS[translation.status] : "尚无译文"}
            {dictionarySummary ? ` · ${dictionarySummary}` : ""}
          </small>
        </header>
        <div>
          {editing ? (
            <CodeMirror
              className="annotation-editor__codemirror"
              value={editContent}
              height="100%"
              maxHeight="100%"
              extensions={editorExtensions}
              onChange={onEditContentChange}
              placeholder={
                translation?.source_kind === "tags"
                  ? "每行填写一个 Tag 译文，行数与左侧 Tags 一致。"
                  : "输入译文；XML、换行与标点结构必须和左侧一致。"
              }
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: false,
              }}
            />
          ) : mismatch ? (
            <div className="translation-compare__mismatch" role="status">
              <strong>当前不匹配</strong>
              <span>{translation?.issue}</span>
              <small>旧译文没有在这里显示，可在“历史”中追溯。</small>
            </div>
          ) : translation?.status === "missing" ? (
            <div className="annotation-editor__empty">当前来源尚无译文。</div>
          ) : canRenderAligned ? (
            renderAlignedParts("translated", translation!.alignment_parts)
          ) : translatedContent ? (
            <div className="translation-compare__unaligned">
              {translation?.issue ? (
                <div className="translation-compare__warning">{translation.issue}</div>
              ) : null}
              <pre className="translation-compare__plain">{translatedContent}</pre>
            </div>
          ) : (
            <div className="annotation-editor__empty">
              {translation?.issue ?? "当前没有可显示的译文。"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
