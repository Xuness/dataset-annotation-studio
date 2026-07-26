import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import CodeMirror from "@uiw/react-codemirror";

import type {
  AnnotationTag,
  AnnotationTaggerSource,
  TagDictionaryResolution,
  TranslationAlignmentPart,
  TranslationDocument,
} from "../../../shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import { TRANSLATION_STATUS_LABELS } from "./annotationLabels";
import { groupTags, normalizeTagKey } from "./tagEditorState";
import { TagEditorPanel } from "./TagEditorPanel";
import { annotationTagTitle, tagCategoryLabel, tagCategoryTone } from "./tagPresentation";

interface TranslationTagEditor {
  projectId: string;
  assetId: string;
  tags: AnnotationTag[];
  taggerSource: AnnotationTaggerSource | null;
  fontSize: number;
  dirty: boolean;
  readOnly: boolean;
  onChange: (tags: AnnotationTag[]) => void;
  onFontSizeChange: (fontSize: number) => void;
}

interface TranslationComparePanelProps {
  translation: TranslationDocument | undefined;
  loading: boolean;
  error: unknown;
  editing: boolean;
  editContent: string;
  editorExtensions: NonNullable<ComponentProps<typeof CodeMirror>["extensions"]>;
  onEditContentChange: (content: string) => void;
  tagEditor?: TranslationTagEditor;
  dictionaryPreview?: TagDictionaryResolution;
  dictionaryPreviewLoading?: boolean;
  dictionaryPreviewError?: unknown;
}

type AlignmentSide = "source" | "translated";

interface ScrollSyncPoint {
  from: number;
  to: number;
}

interface ScrollSyncCache {
  layoutKey: string;
  sourceToTranslated: ScrollSyncPoint[];
  translatedToSource: ScrollSyncPoint[];
}

interface SuppressedScroll {
  side: AlignmentSide;
  top: number;
}

interface AlignmentVerticalRange {
  top: number;
  bottom: number;
}

interface HighlightScrollAnimation {
  side: AlignmentSide;
  frameId: number;
  startTop: number;
  targetTop: number;
  startedAt: number | null;
  lastAppliedTop: number;
}

// Keep corresponding clauses near the upper reading third, then interpolate
// between them so different source/translation lengths still scroll smoothly.
const SCROLL_READING_ANCHOR = 0.35;
const SCROLL_POSITION_EPSILON = 1;
const HIGHLIGHT_VISIBILITY_MARGIN = 8;
const HIGHLIGHT_SCROLL_DURATION_MS = 160;
const HIGHLIGHT_SCROLL_MIN_DISTANCE = 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function maximumScrollTop(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function scrollSyncLayoutKey(source: HTMLElement, translated: HTMLElement): string {
  return [
    source.clientWidth,
    source.clientHeight,
    source.scrollHeight,
    translated.clientWidth,
    translated.clientHeight,
    translated.scrollHeight,
  ].join(":");
}

function collectAlignmentCenters(container: HTMLElement): Map<string, number> {
  const containerBounds = container.getBoundingClientRect();
  const centers = new Map<string, number>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-alignment-id]")) {
    const id = element.dataset.alignmentId;
    if (!id) continue;
    const bounds = element.getBoundingClientRect();
    centers.set(
      id,
      bounds.top - containerBounds.top + container.scrollTop + Math.max(bounds.height, 0) / 2,
    );
  }
  return centers;
}

function scrollPositionForCenter(container: HTMLElement, center: number): number {
  return clamp(
    center - container.clientHeight * SCROLL_READING_ANCHOR,
    0,
    maximumScrollTop(container),
  );
}

function buildScrollSyncPoints(
  driver: HTMLElement,
  follower: HTMLElement,
  driverCenters: Map<string, number>,
  followerCenters: Map<string, number>,
): ScrollSyncPoint[] {
  const driverMaximum = maximumScrollTop(driver);
  const followerMaximum = maximumScrollTop(follower);
  const rawPoints: ScrollSyncPoint[] = [
    { from: 0, to: 0 },
    { from: driverMaximum, to: followerMaximum },
  ];

  for (const [id, driverCenter] of driverCenters) {
    const followerCenter = followerCenters.get(id);
    if (followerCenter === undefined) continue;
    rawPoints.push({
      from: scrollPositionForCenter(driver, driverCenter),
      to: scrollPositionForCenter(follower, followerCenter),
    });
  }
  rawPoints.sort((left, right) => left.from - right.from);

  const groupedPoints: Array<{ from: number; targets: number[] }> = [];
  for (const point of rawPoints) {
    const previous = groupedPoints.at(-1);
    if (previous && Math.abs(previous.from - point.from) <= SCROLL_POSITION_EPSILON) {
      previous.targets.push(point.to);
    } else {
      groupedPoints.push({ from: point.from, targets: [point.to] });
    }
  }

  let previousTarget = 0;
  return groupedPoints.map((point) => {
    let target = point.targets.reduce((total, value) => total + value, 0) / point.targets.length;
    if (point.from <= SCROLL_POSITION_EPSILON) {
      target = 0;
    } else if (point.from >= driverMaximum - SCROLL_POSITION_EPSILON) {
      target = followerMaximum;
    }
    target = clamp(Math.max(previousTarget, target), 0, followerMaximum);
    previousTarget = target;
    return { from: point.from, to: target };
  });
}

function buildScrollSyncCache(source: HTMLElement, translated: HTMLElement): ScrollSyncCache {
  const sourceCenters = collectAlignmentCenters(source);
  const translatedCenters = collectAlignmentCenters(translated);
  return {
    layoutKey: scrollSyncLayoutKey(source, translated),
    sourceToTranslated: buildScrollSyncPoints(source, translated, sourceCenters, translatedCenters),
    translatedToSource: buildScrollSyncPoints(translated, source, translatedCenters, sourceCenters),
  };
}

function interpolateScrollPosition(points: ScrollSyncPoint[], position: number): number {
  if (!points.length) return 0;
  if (position <= points[0].from) return points[0].to;
  const finalPoint = points.at(-1);
  if (finalPoint && position >= finalPoint.from) return finalPoint.to;

  let lowerIndex = 0;
  let upperIndex = points.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (points[middleIndex].from < position) {
      lowerIndex = middleIndex;
    } else {
      upperIndex = middleIndex;
    }
  }
  const lower = points[lowerIndex];
  const upper = points[upperIndex];
  const distance = upper.from - lower.from;
  if (distance <= SCROLL_POSITION_EPSILON) return upper.to;
  const progress = (position - lower.from) / distance;
  return lower.to + (upper.to - lower.to) * progress;
}

function collectAlignmentRange(
  container: HTMLElement,
  alignmentIds: readonly string[],
): AlignmentVerticalRange | null {
  const requestedIds = new Set(alignmentIds);
  const containerBounds = container.getBoundingClientRect();
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const element of container.querySelectorAll<HTMLElement>("[data-alignment-id]")) {
    if (!element.dataset.alignmentId || !requestedIds.has(element.dataset.alignmentId)) continue;
    const bounds = element.getBoundingClientRect();
    top = Math.min(top, bounds.top - containerBounds.top + container.scrollTop);
    bottom = Math.max(bottom, bounds.bottom - containerBounds.top + container.scrollTop);
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

function alignmentRangeIsVisible(container: HTMLElement, range: AlignmentVerticalRange): boolean {
  const margin = Math.min(HIGHLIGHT_VISIBILITY_MARGIN, container.clientHeight / 4);
  const viewportTop = container.scrollTop + margin;
  const viewportBottom = container.scrollTop + container.clientHeight - margin;
  if (range.bottom - range.top > viewportBottom - viewportTop) {
    return range.bottom > viewportTop && range.top < viewportBottom;
  }
  return range.top >= viewportTop && range.bottom <= viewportBottom;
}

function scrollTopToRevealAlignment(
  container: HTMLElement,
  range: AlignmentVerticalRange,
): number | null {
  if (alignmentRangeIsVisible(container, range)) return null;
  const margin = Math.min(HIGHLIGHT_VISIBILITY_MARGIN, container.clientHeight / 4);
  const viewportTop = container.scrollTop + margin;
  const viewportBottom = container.scrollTop + container.clientHeight - margin;
  const nextTop =
    range.top < viewportTop
      ? range.top - margin
      : range.bottom > viewportBottom
        ? range.bottom - container.clientHeight + margin
        : container.scrollTop;
  return clamp(nextTop, 0, maximumScrollTop(container));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

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

function dictionaryEntryTitle(
  tag: AnnotationTag,
  resolution: TagDictionaryResolution | undefined,
  index: number,
): string {
  const entry = resolution?.entries[index];
  if (!entry) return `类别：${tagCategoryLabel(tag.category)}`;
  if (!entry.matched) {
    return `类别：${tagCategoryLabel(tag.category)} · 本地词典未命中，暂时保留原 Tag`;
  }
  const source =
    entry.source_kind === "override" ? "词条修正" : (entry.installation_name ?? "本地 Tag 词典");
  return `类别：${tagCategoryLabel(tag.category)} · 来源：${source}`;
}

export function TranslationComparePanel({
  translation,
  loading,
  error,
  editing,
  editContent,
  editorExtensions,
  onEditContentChange,
  tagEditor,
  dictionaryPreview,
  dictionaryPreviewLoading = false,
  dictionaryPreviewError,
}: TranslationComparePanelProps) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const translatedRef = useRef<HTMLDivElement>(null);
  const scrollSyncCacheRef = useRef<ScrollSyncCache | null>(null);
  const suppressedScrollRef = useRef<SuppressedScroll | null>(null);
  const highlightSideRef = useRef<AlignmentSide | null>(null);
  const highlightScrollAnimationRef = useRef<HighlightScrollAnimation | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const isTags = translation?.source_kind === "tags";
  const fallbackTags =
    translation?.source_tags.length || !isTags
      ? (translation?.source_tags ?? [])
      : (translation?.alignment_parts
          .filter((part) => part.kind === "tag")
          .map((part) => ({
            name: part.source_text,
            category: part.category,
            confidence: part.confidence,
            origin: "translation_source",
          })) ?? []);
  const tags = tagEditor?.tags ?? fallbackTags;
  const tagSignature = tags
    .map((tag) => `${normalizeTagKey(tag.name)}:${tag.category ?? ""}`)
    .join("\u0000");
  const persistedAligned =
    !editing && translation?.status === "current" && translation.alignment_status === "aligned";
  const previewAligned =
    isTags &&
    translation?.producer_kind === "local_dictionary" &&
    dictionaryPreview?.entries.length === tags.length;
  const aligned = Boolean(persistedAligned || previewAligned);
  const activeIds = useMemo(
    () => new Set(pinnedIds.length ? pinnedIds : hoveredId ? [hoveredId] : []),
    [hoveredId, pinnedIds],
  );

  const cancelHighlightScrollAnimation = useCallback(() => {
    const animation = highlightScrollAnimationRef.current;
    if (animation) window.cancelAnimationFrame(animation.frameId);
    highlightScrollAnimationRef.current = null;
  }, []);

  const applyProgrammaticScroll = useCallback(
    (side: AlignmentSide, container: HTMLElement, top: number) => {
      suppressedScrollRef.current = { side, top };
      container.scrollTop = top;
    },
    [],
  );

  const animateHighlightScroll = useCallback(
    (side: AlignmentSide, container: HTMLElement, targetTop: number) => {
      cancelHighlightScrollAnimation();
      const startTop = container.scrollTop;
      if (
        prefersReducedMotion() ||
        typeof window.requestAnimationFrame !== "function" ||
        Math.abs(targetTop - startTop) < HIGHLIGHT_SCROLL_MIN_DISTANCE
      ) {
        applyProgrammaticScroll(side, container, targetTop);
        return;
      }

      const animation: HighlightScrollAnimation = {
        side,
        frameId: 0,
        startTop,
        targetTop,
        startedAt: null,
        lastAppliedTop: startTop,
      };
      const step = (timestamp: number) => {
        if (highlightScrollAnimationRef.current !== animation) return;
        animation.startedAt ??= timestamp;
        const progress = Math.min(
          1,
          (timestamp - animation.startedAt) / HIGHLIGHT_SCROLL_DURATION_MS,
        );
        const nextTop =
          animation.startTop + (animation.targetTop - animation.startTop) * easeOutCubic(progress);
        animation.lastAppliedTop = nextTop;
        applyProgrammaticScroll(side, container, nextTop);
        if (progress < 1) {
          animation.frameId = window.requestAnimationFrame(step);
        } else {
          highlightScrollAnimationRef.current = null;
        }
      };

      highlightScrollAnimationRef.current = animation;
      animation.frameId = window.requestAnimationFrame(step);
    },
    [applyProgrammaticScroll, cancelHighlightScrollAnimation],
  );

  useEffect(() => {
    setHoveredId(null);
    setPinnedIds([]);
    cancelHighlightScrollAnimation();
    scrollSyncCacheRef.current = null;
    suppressedScrollRef.current = null;
    highlightSideRef.current = null;
  }, [
    translation?.asset_id,
    translation?.language,
    translation?.source_kind,
    translation?.producer_kind,
    translation?.modified_at,
    tagSignature,
    editing,
    cancelHighlightScrollAnimation,
  ]);

  useEffect(
    () => () => {
      cancelHighlightScrollAnimation();
    },
    [cancelHighlightScrollAnimation],
  );

  function handleAlignedScroll(side: AlignmentSide) {
    if (!persistedAligned || isTags) return;
    const source = sourceRef.current;
    const translated = translatedRef.current;
    if (!source || !translated) return;
    const driver = side === "source" ? source : translated;
    const follower = side === "source" ? translated : source;

    const suppressed = suppressedScrollRef.current;
    if (suppressed?.side === side) {
      suppressedScrollRef.current = null;
      if (Math.abs(driver.scrollTop - suppressed.top) <= SCROLL_POSITION_EPSILON) return;
    }

    const animation = highlightScrollAnimationRef.current;
    if (
      animation?.side === side &&
      Math.abs(driver.scrollTop - animation.lastAppliedTop) <= SCROLL_POSITION_EPSILON
    ) {
      return;
    }
    cancelHighlightScrollAnimation();

    const layoutKey = scrollSyncLayoutKey(source, translated);
    let cache = scrollSyncCacheRef.current;
    if (!cache || cache.layoutKey !== layoutKey) {
      cache = buildScrollSyncCache(source, translated);
      scrollSyncCacheRef.current = cache;
    }
    const points = side === "source" ? cache.sourceToTranslated : cache.translatedToSource;
    const nextTop = clamp(
      interpolateScrollPosition(points, driver.scrollTop),
      0,
      maximumScrollTop(follower),
    );
    if (Math.abs(follower.scrollTop - nextTop) <= SCROLL_POSITION_EPSILON) return;

    suppressedScrollRef.current = {
      side: side === "source" ? "translated" : "source",
      top: nextTop,
    };
    follower.scrollTop = nextTop;
  }

  useLayoutEffect(() => {
    cancelHighlightScrollAnimation();
    if (!persistedAligned || isTags) return;
    const alignmentIds = pinnedIds.length ? pinnedIds : hoveredId ? [hoveredId] : [];
    const highlightSide = highlightSideRef.current;
    const source = sourceRef.current;
    const translated = translatedRef.current;
    if (!alignmentIds.length || !highlightSide || !source || !translated) return;

    const sourceRange = collectAlignmentRange(source, alignmentIds);
    const translatedRange = collectAlignmentRange(translated, alignmentIds);
    if (!sourceRange || !translatedRange) return;
    const sourceVisible = alignmentRangeIsVisible(source, sourceRange);
    const translatedVisible = alignmentRangeIsVisible(translated, translatedRange);
    if (sourceVisible && translatedVisible) return;

    const targetSide: AlignmentSide = highlightSide === "source" ? "translated" : "source";
    const target = targetSide === "source" ? source : translated;
    const targetRange = targetSide === "source" ? sourceRange : translatedRange;
    if (targetSide === "source" ? sourceVisible : translatedVisible) return;
    const nextTop = scrollTopToRevealAlignment(target, targetRange);
    if (nextTop === null || Math.abs(target.scrollTop - nextTop) <= SCROLL_POSITION_EPSILON) {
      return;
    }

    animateHighlightScroll(targetSide, target, nextTop);
  }, [
    animateHighlightScroll,
    cancelHighlightScrollAnimation,
    hoveredId,
    isTags,
    persistedAligned,
    pinnedIds,
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
      highlightSideRef.current = side;
      setPinnedIds(Array.from(new Set(ids)));
      setHoveredId(null);
    }
  }

  function handleKeyDown(side: AlignmentSide, event: KeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") {
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;
    event.preventDefault();

    const range = document.createRange();
    range.selectNodeContents(event.currentTarget);
    selection.removeAllRanges();
    selection.addRange(range);
    captureSelection(side);
  }

  function handleKeyUp(side: AlignmentSide, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      setPinnedIds([]);
      return;
    }
    captureSelection(side);
  }

  function setTagSelection(keys: string[]) {
    if (!aligned || !keys.length) return;
    setPinnedIds(Array.from(new Set(keys)));
    setHoveredId(null);
  }

  function setTagHover(key: string | null) {
    if (!aligned || pinnedIds.length) return;
    setHoveredId(key);
  }

  function renderDescriptionParts(side: AlignmentSide, parts: TranslationAlignmentPart[]) {
    return (
      <div
        ref={side === "source" ? sourceRef : translatedRef}
        className="translation-compare__aligned translation-compare__aligned--description"
        aria-label={side === "source" ? "原文内容" : "译文内容"}
        onMouseUp={() => captureSelection(side)}
        onKeyDown={(event) => handleKeyDown(side, event)}
        onKeyUp={(event) => handleKeyUp(side, event)}
        onScroll={() => handleAlignedScroll(side)}
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
              onPointerEnter={() => {
                if (alignable && !pinnedIds.length) {
                  highlightSideRef.current = side;
                  setHoveredId(part.id);
                }
              }}
              onPointerLeave={() => {
                if (alignable && !pinnedIds.length) setHoveredId(null);
              }}
            >
              {value}
            </span>
          );
        })}
      </div>
    );
  }

  const persistedTagParts =
    translation?.alignment_parts.filter((part) => part.kind === "tag") ?? [];
  const canRenderPersistedTags = Boolean(
    !tagEditor?.dirty && persistedAligned && persistedTagParts.length === tags.length,
  );

  function renderTagGroups(side: AlignmentSide) {
    const groups = groupTags(tags);
    const ref = side === "source" ? sourceRef : translatedRef;
    return (
      <div
        ref={ref}
        className="tag-editor__groups translation-compare__tag-groups"
        aria-label={side === "source" ? "原文 Tags" : "译文 Tags"}
        onMouseUp={() => captureSelection(side)}
        onKeyDown={(event) => handleKeyDown(side, event)}
        onKeyUp={(event) => handleKeyUp(side, event)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setPinnedIds([]);
        }}
        tabIndex={0}
      >
        {groups.length ? (
          groups.map((group) => (
            <section
              key={`${side}:${group.category ?? "uncategorized"}`}
              className="tag-editor__group translation-compare__tag-group"
              data-category-tone={tagCategoryTone(group.category)}
            >
              <header>
                <strong>{tagCategoryLabel(group.category)}</strong>
                <span>{group.items.length}</span>
              </header>
              <div className="tag-editor__chips">
                {group.items.map(({ index, key, tag }) => {
                  const entry = previewAligned ? dictionaryPreview?.entries[index] : undefined;
                  const part = canRenderPersistedTags ? persistedTagParts[index] : undefined;
                  const value =
                    side === "source"
                      ? tag.name
                      : (entry?.translation ?? entry?.requested_tag ?? part?.translated_text ?? "");
                  if (side === "translated" && !value) return null;
                  return (
                    <span
                      key={`${side}:${key}`}
                      className={[
                        "tag-editor__chip",
                        "translation-compare__tag-chip",
                        activeIds.has(key) ? "is-linked" : "",
                        side === "translated" && entry && !entry.matched ? "is-unmatched" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-alignment-id={key}
                      title={
                        side === "source"
                          ? annotationTagTitle(tag)
                          : dictionaryEntryTitle(tag, dictionaryPreview, index)
                      }
                      onPointerEnter={() => setTagHover(key)}
                      onPointerLeave={() => setTagHover(null)}
                    >
                      <span>{value}</span>
                      {side === "source" && tag.confidence !== null ? (
                        <small>{Math.round(tag.confidence * 100)}%</small>
                      ) : null}
                      {side === "translated" && entry && !entry.matched ? (
                        <small>未命中</small>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="tag-editor__empty">
            <strong>还没有 Tag</strong>
            <span>{side === "source" ? "可以从上方快速添加。" : "没有可预览的词典译文。"}</span>
          </div>
        )}
      </div>
    );
  }

  function renderPlainContent(side: AlignmentSide, content: string) {
    return (
      <pre
        className="translation-compare__plain"
        aria-label={side === "source" ? "原文内容" : "译文内容"}
        onKeyDown={(event) => handleKeyDown(side, event)}
        tabIndex={0}
      >
        {content}
      </pre>
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
  const canRenderDescription = Boolean(
    !isTags && persistedAligned && translation?.alignment_parts.length,
  );
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
  const previewSummary = previewAligned
    ? [
        tagEditor?.dirty ? "未保存预览" : "本地词典实时预览",
        dictionaryPreview?.unmatched_count
          ? `未命中 ${dictionaryPreview.unmatched_count} 项`
          : "全部命中",
      ].join(" · ")
    : "";
  const translatedHeaderStatus =
    previewSummary ||
    (translation?.status === "current" && translation.quality_status === "warning"
      ? "译文需复核"
      : translation
        ? TRANSLATION_STATUS_LABELS[translation.status]
        : "尚无译文");
  const qualityIssues =
    !editing && translation?.status === "current" ? translation.quality_issues : [];

  function renderTranslatedContent() {
    if (editing) {
      return (
        <CodeMirror
          className="annotation-editor__codemirror"
          value={editContent}
          height="100%"
          maxHeight="100%"
          extensions={editorExtensions}
          onChange={onEditContentChange}
          placeholder={
            isTags
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
      );
    }
    if (isTags && tagEditor?.dirty && translation?.producer_kind !== "local_dictionary") {
      return (
        <div className="translation-compare__mismatch" role="status">
          <strong>Tags 尚未保存</strong>
          <span>保存当前 Tags 后，原有 LLM 译文会变为“当前不匹配”。</span>
          <small>为了避免参照错误内容，这里不会继续显示旧译文。</small>
        </div>
      );
    }
    if (isTags && translation?.producer_kind === "local_dictionary") {
      if (!tags.length) {
        return (
          <div className="translation-compare__mismatch" role="status">
            <strong>当前没有 Tag</strong>
            <span>添加 Tag 后，本地词典译文会在这里实时出现。</span>
          </div>
        );
      }
      if (dictionaryPreviewLoading) {
        return (
          <div className="annotation-editor__empty">
            <Spinner label="查询本地词典" />
          </div>
        );
      }
      if (dictionaryPreviewError) {
        return (
          <div className="translation-compare__mismatch" role="status">
            <strong>词典预览失败</strong>
            <span>
              {dictionaryPreviewError instanceof Error
                ? dictionaryPreviewError.message
                : "无法读取本地 Tag 词典。"}
            </span>
            <small>没有显示旧译文，以免与当前 Tags 不匹配。</small>
          </div>
        );
      }
      if (previewAligned) return renderTagGroups("translated");
    }
    if (mismatch) {
      return (
        <div className="translation-compare__mismatch" role="status">
          <strong>当前不匹配</strong>
          <span>{translation?.issue}</span>
          <small>旧译文没有在这里显示，可在“历史”中追溯。</small>
        </div>
      );
    }
    if (translation?.status === "missing") {
      return <div className="annotation-editor__empty">当前来源尚无译文。</div>;
    }
    if (isTags && canRenderPersistedTags) return renderTagGroups("translated");
    if (canRenderDescription) {
      return renderDescriptionParts("translated", translation!.alignment_parts);
    }
    if (translatedContent) {
      return (
        <div className="translation-compare__unaligned">
          {translation?.issue ? (
            <div className="translation-compare__warning">{translation.issue}</div>
          ) : null}
          {renderPlainContent("translated", translatedContent)}
        </div>
      );
    }
    return (
      <div className="annotation-editor__empty">
        {translation?.issue ?? "当前没有可显示的译文。"}
      </div>
    );
  }

  return (
    <div className="annotation-editor__compare translation-compare">
      <section>
        <header>
          <strong>{translation ? sourceLabel(translation) : "源标注"}</strong>
          <small>
            {tagEditor?.dirty
              ? `未保存修改 · ${tags.length} Tags`
              : translation?.source_revision_id
                ? `当前源 · ${translation.source_revision_id.slice(0, 8)}`
                : "缺失"}
          </small>
        </header>
        <div>
          {isTags && tagEditor ? (
            <TagEditorPanel
              projectId={tagEditor.projectId}
              assetId={tagEditor.assetId}
              tags={tagEditor.tags}
              taggerSource={tagEditor.taggerSource}
              fontSize={tagEditor.fontSize}
              onChange={tagEditor.onChange}
              onFontSizeChange={tagEditor.onFontSizeChange}
              readOnly={tagEditor.readOnly}
              linkedTagKeys={activeIds}
              onTagHoverChange={setTagHover}
              onTagSelectionChange={setTagSelection}
              compact
            />
          ) : !hasSource ? (
            <div className="annotation-editor__empty">
              {translation?.issue ?? "当前没有可用的源标注。"}
            </div>
          ) : isTags ? (
            renderTagGroups("source")
          ) : canRenderDescription ? (
            renderDescriptionParts("source", translation!.alignment_parts)
          ) : (
            renderPlainContent("source", sourceContent)
          )}
        </div>
      </section>

      <section>
        <header>
          <strong>{translation?.language ?? ""} 译文</strong>
          <small title={previewSummary || dictionarySummary || undefined}>
            {translatedHeaderStatus}
            {!previewSummary && dictionarySummary ? ` · ${dictionarySummary}` : ""}
          </small>
        </header>
        <div className={qualityIssues.length ? "translation-compare__quality-layout" : undefined}>
          {qualityIssues.length ? (
            <div className="translation-compare__warning" role="status">
              <strong>译文质量提醒：</strong>
              {qualityIssues.join(" ")}
            </div>
          ) : null}
          {renderTranslatedContent()}
        </div>
      </section>
    </div>
  );
}
