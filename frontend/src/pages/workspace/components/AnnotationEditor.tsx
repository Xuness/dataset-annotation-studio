import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import {
  BadgeCheck,
  FileText,
  History,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  useAnnotationBundle,
  useAnnotationChannel,
  useAnnotationChannelHistory,
  useDeleteAnnotationChannel,
  useReviewAnnotationChannel,
  useSaveAnnotationChannel,
} from "../../../features/annotations/hooks";
import { useTagDictionaryResolution } from "../../../features/tagDictionaries/hooks";
import {
  useRefreshLocalDictionaryTranslation,
  useTranslation,
  useTranslations,
} from "../../../features/translations/hooks";
import type {
  AnnotationChannel,
  AnnotationChannelTarget,
  AnnotationDocument,
  AnnotationTag,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../../shared/api/types";
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { annotationEditorViewState } from "../workspaceViewState";
import { AnnotationHistoryPanel } from "./AnnotationHistoryPanel";
import {
  AVAILABILITY_LABELS,
  REVIEW_LABELS,
  revisionSourceLabel,
  TRANSLATION_STATUS_LABELS,
} from "./annotationLabels";
import { hasExistingAnnotationDocument, reconcilePersistedContent } from "./annotationEditorState";
import { annotationTagsEqual, reconcilePersistedTags } from "./tagEditorState";
import { TagEditorPanel } from "./TagEditorPanel";
import { TranslationComparePanel } from "./TranslationComparePanel";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean, kind: "tags" | "annotation" | null) => void;
  onActiveTargetChange: (target: AnnotationChannelTarget) => void;
}

type EditorMode = AnnotationChannel;

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";
const DEFAULT_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko"];
const EXISTING_ANNOTATION_TAB = {
  value: "existing_annotation",
  label: "原有标注",
} as const;
const DEFAULT_CHANNEL_TABS: Array<{ value: EditorMode; label: string }> = [
  { value: "tags", label: "Tags" },
  { value: "description", label: "LLM 描述" },
  { value: "translation", label: "翻译对照" },
];

function readFontSize(): number {
  const stored = Number.parseInt(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? "12", 10);
  return Number.isFinite(stored) ? Math.min(22, Math.max(10, stored)) : 12;
}

function documentDraft(document: AnnotationDocument | undefined): string {
  return document?.content ?? "";
}

export function AnnotationEditor({
  projectId,
  assetId,
  onDirtyChange,
  onActiveTargetChange,
}: AnnotationEditorProps) {
  // View selections live in a session-scoped store so they survive the
  // per-asset remount of this component and route changes within a project.
  const { mode, language, translationSourceKind, translationProducerKind } =
    annotationEditorViewState.useValue(projectId);
  const setMode = useCallback(
    (next: EditorMode) => annotationEditorViewState.patch(projectId, { mode: next }),
    [projectId],
  );
  const setLanguage = useCallback(
    (next: string) => annotationEditorViewState.patch(projectId, { language: next }),
    [projectId],
  );
  const setTranslationSourceKind = useCallback(
    (next: TranslationSourceKind) =>
      annotationEditorViewState.patch(projectId, { translationSourceKind: next }),
    [projectId],
  );
  const setTranslationProducerKind = useCallback(
    (next: TranslationProducerKind) =>
      annotationEditorViewState.patch(projectId, { translationProducerKind: next }),
    [projectId],
  );
  const [translationEditing, setTranslationEditing] = useState(false);
  const activeLanguage = mode === "translation" ? language : "";
  const bundle = useAnnotationBundle(projectId, assetId);
  const document = useAnnotationChannel(
    projectId,
    assetId,
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const tagsDocument = useAnnotationChannel(projectId, assetId, "tags");
  const translations = useTranslations(projectId, assetId);
  const translationState = useTranslation(
    projectId,
    assetId,
    language,
    translationSourceKind,
    translationProducerKind,
  );
  const save = useSaveAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const saveTags = useSaveAnnotationChannel(projectId, assetId ?? "", "tags");
  const refreshLocalDictionary = useRefreshLocalDictionaryTranslation(
    projectId,
    assetId ?? "",
    language,
  );
  const review = useReviewAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const remove = useDeleteAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<AnnotationTag[]>([]);
  const [savedTagDraft, setSavedTagDraft] = useState<AnnotationTag[]>([]);
  const [savedTagRevisionId, setSavedTagRevisionId] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [showHistory, setShowHistory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tagEditingActive =
    mode === "tags" || (mode === "translation" && translationSourceKind === "tags");
  const tagsDirty = tagEditingActive && !annotationTagsEqual(tagDraft, savedTagDraft);
  const dirty =
    tagsDirty ||
    (mode === "translation"
      ? translationEditing && content !== savedContent
      : mode === "tags"
        ? false
        : content !== savedContent);
  const dirtyRef = useRef(dirty);
  const loadedDocumentKey = useRef("");
  dirtyRef.current = dirty;
  const history = useAnnotationChannelHistory(
    projectId,
    assetId,
    mode,
    activeLanguage,
    showHistory,
    translationSourceKind,
    translationProducerKind,
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_LANGUAGES,
          language,
          ...(translations.data?.map((item) => item.language) ?? []),
        ]),
      ),
    [language, translations.data],
  );
  const hasExistingAnnotation = hasExistingAnnotationDocument(bundle.data?.documents);
  const dictionaryPreview = useTagDictionaryResolution(
    useMemo(() => tagDraft.map((tag) => ({ name: tag.name, category: tag.category })), [tagDraft]),
    language,
    mode === "translation" &&
      translationSourceKind === "tags" &&
      translationProducerKind === "local_dictionary",
  );
  const channelTabs = useMemo(
    () =>
      hasExistingAnnotation
        ? [EXISTING_ANNOTATION_TAB, ...DEFAULT_CHANNEL_TABS]
        : DEFAULT_CHANNEL_TABS,
    [hasExistingAnnotation],
  );

  useUnsavedScope(`${tagsDirty ? "annotation-tags" : "annotation"}:${projectId}`, dirty);
  useEffect(
    () => onDirtyChange(dirty, dirty ? (tagsDirty ? "tags" : "annotation") : null),
    [dirty, onDirtyChange, tagsDirty],
  );
  useEffect(
    () =>
      onActiveTargetChange(
        mode === "translation" && tagsDirty
          ? {
              channel: "tags",
              language: "",
              translation_source_kind: null,
              translation_producer_kind: null,
            }
          : {
              channel: mode,
              language: activeLanguage,
              translation_source_kind: mode === "translation" ? translationSourceKind : null,
              translation_producer_kind: mode === "translation" ? translationProducerKind : null,
            },
      ),
    [
      activeLanguage,
      mode,
      onActiveTargetChange,
      tagsDirty,
      translationProducerKind,
      translationSourceKind,
    ],
  );

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    const key = `${assetId ?? ""}:${mode}:${activeLanguage}:${translationSourceKind}:${translationProducerKind}`;
    if (!assetId) {
      loadedDocumentKey.current = key;
      setContent("");
      setSavedContent("");
      setSavedRevisionId(null);
      setTagDraft([]);
      setSavedTagDraft([]);
      setSavedTagRevisionId(null);
      setTranslationEditing(false);
      return;
    }
    if (
      !document.data ||
      (mode === "translation" && !translationState.data) ||
      (tagEditingActive && !tagsDocument.data)
    ) {
      return;
    }
    if (loadedDocumentKey.current !== key || !dirtyRef.current) {
      const next =
        mode === "translation"
          ? (translationState.data?.content ?? "")
          : documentDraft(document.data);
      const nextTags =
        mode === "tags"
          ? document.data.tags
          : mode === "translation" && translationSourceKind === "tags"
            ? (tagsDocument.data?.tags ?? [])
            : [];
      loadedDocumentKey.current = key;
      setContent(next);
      setSavedContent(next);
      setSavedRevisionId(document.data.head_revision_id);
      setTagDraft([...nextTags]);
      setSavedTagDraft([...nextTags]);
      setSavedTagRevisionId(
        mode === "tags"
          ? document.data.head_revision_id
          : (tagsDocument.data?.head_revision_id ?? null),
      );
    }
  }, [
    activeLanguage,
    assetId,
    document.data,
    mode,
    tagEditingActive,
    tagsDocument.data,
    translationProducerKind,
    translationSourceKind,
    translationState.data,
  ]);

  useEffect(() => {
    if (
      mode !== "existing_annotation" ||
      bundle.isLoading ||
      hasExistingAnnotation ||
      dirtyRef.current
    ) {
      return;
    }
    resetDraft();
    setMode("description");
  }, [bundle.isLoading, hasExistingAnnotation, mode, setMode]);

  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (
          assetId &&
          dirty &&
          !save.isPending &&
          !saveTags.isPending &&
          !refreshLocalDictionary.isPending
        ) {
          void handleSaveClick();
        }
      }
    }
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  });

  const commonExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        wheel(event, view) {
          if (!event.ctrlKey || event.deltaY === 0) return false;
          event.preventDefault();
          setFontSize((current) =>
            Math.min(22, Math.max(10, current + (event.deltaY < 0 ? 1 : -1))),
          );
          view.requestMeasure();
          return true;
        },
      }),
    ],
    [],
  );
  const editorExtensions = useMemo(() => [xml(), ...commonExtensions], [commonExtensions]);

  function channelState(channel: AnnotationChannel, targetLanguage = "") {
    const item = bundle.data?.documents.find(
      (candidate) =>
        candidate.channel === channel &&
        (candidate.language ?? "") === targetLanguage &&
        (channel !== "translation" ||
          (candidate.translation_source_kind === translationSourceKind &&
            candidate.translation_producer_kind === translationProducerKind)),
    );
    if (!item || item.availability_status === "missing") return undefined;
    if (item.availability_status !== "usable") return item.availability_status;
    return item.review_status === "reviewed" ? "reviewed" : "usable";
  }

  function resetDraft() {
    loadedDocumentKey.current = "";
    setContent("");
    setSavedContent("");
    setSavedRevisionId(null);
    setTagDraft([]);
    setSavedTagDraft([]);
    setSavedTagRevisionId(null);
    setActionError(null);
    setShowHistory(false);
    setTranslationEditing(false);
  }

  async function confirmDiscard(title: string, message: string): Promise<boolean> {
    if (!dirty) return true;
    return confirmDialog(message, {
      title,
      tone: "danger",
      confirmLabel: "放弃并切换",
    });
  }

  function translationDiscardMessage(fallback: string): string {
    return tagsDirty ? "当前 Tags 修改尚未保存，确定丢弃后继续切换吗？" : fallback;
  }

  async function changeMode(next: EditorMode) {
    if (next === mode) return;
    if (
      !(await confirmDiscard(
        "切换标注通道",
        tagsDirty
          ? "当前 Tags 修改尚未保存，确定丢弃后切换通道吗？"
          : "当前通道有尚未保存的修改。确定放弃后切换吗？",
      ))
    ) {
      return;
    }
    resetDraft();
    setMode(next);
  }

  async function changeLanguage(next: string) {
    if (next === language) return;
    if (
      !(await confirmDiscard(
        "切换译文语言",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setLanguage(next);
  }

  async function changeTranslationSource(next: TranslationSourceKind) {
    if (next === translationSourceKind) return;
    if (
      !(await confirmDiscard(
        "切换译文来源",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setTranslationSourceKind(next);
  }

  async function changeTranslationProducer(next: TranslationProducerKind) {
    if (next === translationProducerKind) return;
    if (
      !(await confirmDiscard(
        "切换译文生成方式",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setTranslationProducerKind(next);
    if (next === "local_dictionary") setTranslationSourceKind("tags");
  }

  async function cancelTranslationEdit() {
    if (!(await confirmDiscard("取消编辑译文", "当前译文有尚未保存的修改。确定放弃吗？"))) {
      return;
    }
    const next = translationState.data?.content ?? "";
    setContent(next);
    setSavedContent(next);
    setTranslationEditing(false);
    setActionError(null);
  }

  async function cancelTagChanges() {
    if (!tagsDirty) return;
    const accepted = await confirmDialog("丢弃当前尚未保存的 Tags 修改吗？", {
      title: "放弃 Tags 修改",
      tone: "danger",
      confirmLabel: "丢弃修改",
      cancelLabel: "继续编辑",
    });
    if (!accepted) return;
    setTagDraft([...savedTagDraft]);
    setActionError(null);
  }

  async function saveTagDraft() {
    if (!assetId || !tagsDirty) return;
    const submittedTags = [...tagDraft];
    setActionError(null);
    try {
      const result = await saveTags.mutateAsync({
        tags: submittedTags,
        expectedHeadRevisionId: savedTagRevisionId,
      });
      setTagDraft((current) => reconcilePersistedTags(current, submittedTags, result.tags));
      setSavedTagDraft([...result.tags]);
      setSavedTagRevisionId(result.head_revision_id);
      if (mode === "tags") setSavedRevisionId(result.head_revision_id);

      if (
        mode === "translation" &&
        translationProducerKind === "local_dictionary" &&
        result.tags.length
      ) {
        if (!result.head_revision_id) {
          throw new Error("Tags 已保存，但服务没有返回新的源修订 ID。");
        }
        try {
          const refreshed = await refreshLocalDictionary.mutateAsync({
            expectedSourceRevisionId: result.head_revision_id,
            expectedTranslationRevisionId: translationState.data?.modified_at ?? savedRevisionId,
          });
          setContent(refreshed.content);
          setSavedContent(refreshed.content);
          setSavedRevisionId(refreshed.modified_at);
        } catch (reason) {
          setActionError(
            `Tags 已保存，但本地词典译文刷新失败：${
              reason instanceof Error ? reason.message : "未知错误"
            }`,
          );
        }
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "保存 Tags 失败。");
    }
  }

  async function retryLocalDictionaryRefresh() {
    if (!assetId || tagsDirty || !savedTagRevisionId) return;
    setActionError(null);
    try {
      const refreshed = await refreshLocalDictionary.mutateAsync({
        expectedSourceRevisionId: savedTagRevisionId,
        expectedTranslationRevisionId: translationState.data?.modified_at ?? savedRevisionId,
      });
      setContent(refreshed.content);
      setSavedContent(refreshed.content);
      setSavedRevisionId(refreshed.modified_at);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "刷新本地词典译文失败。");
    }
  }

  async function handleSaveClick() {
    if (!assetId) return;
    if (tagsDirty) {
      await saveTagDraft();
      return;
    }
    const submittedContent = content;
    setActionError(null);
    try {
      const result = await save.mutateAsync({
        content: submittedContent,
        expectedHeadRevisionId: savedRevisionId,
      });
      const persisted = documentDraft(result);
      setContent((current) => reconcilePersistedContent(current, submittedContent, persisted));
      setSavedContent(persisted);
      setSavedRevisionId(result.head_revision_id);
      if (mode === "translation") setTranslationEditing(false);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "保存标注失败。");
    }
  }

  async function handleReview() {
    if (!savedRevisionId || dirty) return;
    setActionError(null);
    try {
      const result = await review.mutateAsync(savedRevisionId);
      setSavedRevisionId(result.head_revision_id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "复核标注失败。");
    }
  }

  async function handleDelete() {
    if (!assetId || !document.data?.exists) return;
    const accepted = await confirmDialog(
      `删除“${document.data.display_name}”的当前版本？历史修订仍会保留。`,
      {
        title: "删除标注通道",
        tone: "danger",
        confirmLabel: "删除",
      },
    );
    if (!accepted) return;
    setActionError(null);
    try {
      await remove.mutateAsync();
      resetDraft();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除标注失败。");
    }
  }

  function restoreRevision(revisionContent: string, tags: AnnotationTag[]) {
    if (mode === "tags") {
      setTagDraft([...tags]);
    } else {
      setContent(revisionContent);
    }
    if (mode === "translation") setTranslationEditing(true);
    setShowHistory(false);
  }

  const translationStatus = translationState.data?.status;
  const activeAvailabilityStatus = document.data?.availability_status ?? "missing";
  const activeReviewStatus = document.data?.review_status;
  const tagCount = tagDraft.length;
  const translationReviewBlocked =
    mode === "translation" &&
    (translationStatus !== "current" || translationState.data?.alignment_status !== "aligned");
  const translationReadOnly =
    mode === "translation" && translationProducerKind === "local_dictionary";
  const tagWritePending = saveTags.isPending || refreshLocalDictionary.isPending;
  const writePending = save.isPending || tagWritePending;
  const canRefreshLocalDictionary =
    translationReadOnly &&
    !tagsDirty &&
    Boolean(savedTagRevisionId) &&
    tagDraft.length > 0 &&
    translationStatus !== "current";

  return (
    <section className="annotation-editor" data-surface-region="content">
      <header className="annotation-editor__header">
        <div className="annotation-editor__title">
          <FileText size={15} />
          <strong>数据库标注</strong>
          <span
            className={`annotation-review annotation-review--${activeAvailabilityStatus}`}
            title="当前通道可用状态"
          >
            {AVAILABILITY_LABELS[activeAvailabilityStatus]}
          </span>
          {activeReviewStatus ? (
            <span
              className={`annotation-review annotation-review--${activeReviewStatus}`}
              title="当前版本人工复核状态"
            >
              {REVIEW_LABELS[activeReviewStatus]}
            </span>
          ) : null}
          {mode === "translation" && translationStatus ? (
            <span className={`translation-status translation-status--${translationStatus}`}>
              {TRANSLATION_STATUS_LABELS[translationStatus]}
            </span>
          ) : null}
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>

        <div className="annotation-editor__view-controls">
          <div className="annotation-view-tabs">
            {channelTabs.map((tab) => {
              const tabStatus = channelState(
                tab.value,
                tab.value === "translation" ? language : "",
              );
              return (
                <button
                  key={tab.value}
                  className={mode === tab.value ? "is-active" : ""}
                  onClick={() => void changeMode(tab.value)}
                >
                  {tab.label}
                  {tabStatus ? (
                    <i
                      className={`annotation-channel-dot annotation-channel-dot--${tabStatus}`}
                      title={
                        tabStatus === "reviewed"
                          ? REVIEW_LABELS.reviewed
                          : AVAILABILITY_LABELS[tabStatus]
                      }
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          {mode === "translation" ? (
            <>
              <select
                className="annotation-source-select"
                aria-label="译文生成方式"
                value={translationProducerKind}
                disabled={writePending}
                onChange={(event) =>
                  void changeTranslationProducer(event.target.value as TranslationProducerKind)
                }
              >
                <option value="llm">LLM 翻译</option>
                <option value="local_dictionary">本地 Tag 词典</option>
              </select>
              <select
                className="annotation-source-select"
                aria-label="译文来源"
                value={translationSourceKind}
                disabled={translationProducerKind === "local_dictionary" || writePending}
                onChange={(event) =>
                  void changeTranslationSource(event.target.value as TranslationSourceKind)
                }
              >
                <option value="description">LLM 描述</option>
                <option value="tags">Tags</option>
              </select>
              <select
                className="annotation-language-select"
                aria-label="译文语言"
                value={language}
                disabled={writePending}
                onChange={(event) => void changeLanguage(event.target.value)}
              >
                {languageOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>

        <div className="annotation-editor__actions">
          <Button
            icon={<History size={14} />}
            onClick={() => setShowHistory((current) => !current)}
            disabled={!assetId || writePending}
          >
            历史
          </Button>
          <Button
            tone="danger"
            icon={<Trash2 size={14} />}
            onClick={() => void handleDelete()}
            disabled={!document.data?.exists || dirty || remove.isPending || writePending}
          >
            删除
          </Button>
          <Button
            icon={review.isPending ? <Spinner /> : <BadgeCheck size={14} />}
            onClick={() => void handleReview()}
            disabled={
              !document.data?.exists ||
              dirty ||
              translationReviewBlocked ||
              (document.data.review_status === "reviewed" &&
                document.data.availability_status !== "stale") ||
              review.isPending ||
              writePending
            }
          >
            标记已复核
          </Button>
          {mode === "translation" ? (
            tagsDirty ? (
              <>
                <Button
                  icon={<X size={14} />}
                  onClick={() => void cancelTagChanges()}
                  disabled={tagWritePending}
                >
                  撤销 Tag 修改
                </Button>
                <Button
                  tone="primary"
                  icon={tagWritePending ? <Spinner /> : <Save size={14} />}
                  onClick={() => void saveTagDraft()}
                  disabled={!assetId || tagWritePending}
                >
                  保存 Tags
                </Button>
              </>
            ) : translationReadOnly ? (
              <>
                <span
                  className="annotation-editor__readonly"
                  title="译文只由本地词典生成；需要改译法时请修改词条修正"
                >
                  只读词典结果
                </span>
                {canRefreshLocalDictionary || refreshLocalDictionary.isPending ? (
                  <Button
                    icon={refreshLocalDictionary.isPending ? <Spinner /> : <RefreshCw size={14} />}
                    onClick={() => void retryLocalDictionaryRefresh()}
                    disabled={refreshLocalDictionary.isPending}
                  >
                    刷新词典译文
                  </Button>
                ) : null}
              </>
            ) : translationEditing ? (
              <>
                <Button
                  icon={<X size={14} />}
                  onClick={() => void cancelTranslationEdit()}
                  disabled={writePending}
                >
                  取消编辑
                </Button>
                <Button
                  tone="primary"
                  icon={writePending ? <Spinner /> : <Save size={14} />}
                  onClick={() => void handleSaveClick()}
                  disabled={!assetId || !dirty || writePending}
                >
                  保存译文
                </Button>
              </>
            ) : (
              <Button
                tone="primary"
                icon={<Pencil size={14} />}
                onClick={() => setTranslationEditing(true)}
                disabled={!assetId || !translationState.data?.source_exists || tagsDirty}
              >
                {translationStatus === "source_mismatch" ? "重新编辑" : "编辑译文"}
              </Button>
            )
          ) : (
            <Button
              tone="primary"
              icon={writePending ? <Spinner /> : <Save size={14} />}
              onClick={() => void handleSaveClick()}
              disabled={!assetId || !dirty || writePending}
            >
              保存
            </Button>
          )}
        </div>
      </header>

      <div
        className="annotation-editor__body"
        style={{ "--annotation-font-size": `${fontSize}px` } as CSSProperties}
      >
        {assetId && (document.isLoading || (tagEditingActive && tagsDocument.isLoading)) ? (
          <div className="annotation-editor__empty">
            <Spinner label="读取标注通道" />
          </div>
        ) : assetId &&
          ((document.isError && !document.data) ||
            (tagEditingActive && tagsDocument.isError && !tagsDocument.data)) ? (
          <div className="annotation-editor__empty validation-warning">
            无法读取标注：
            {document.error instanceof Error
              ? document.error.message
              : tagsDocument.error instanceof Error
                ? tagsDocument.error.message
                : "未知错误"}
          </div>
        ) : assetId && showHistory ? (
          <AnnotationHistoryPanel
            activeChannel={mode}
            revisions={history.data}
            loading={history.isLoading}
            error={history.isError ? history.error : null}
            sourceMismatch={mode === "translation" && translationStatus === "source_mismatch"}
            readOnly={translationReadOnly}
            onRestore={restoreRevision}
          />
        ) : assetId && mode === "tags" ? (
          <TagEditorPanel
            projectId={projectId}
            assetId={assetId}
            tags={tagDraft}
            taggerSource={document.data?.tagger_source ?? null}
            fontSize={fontSize}
            onChange={setTagDraft}
            onFontSizeChange={setFontSize}
          />
        ) : assetId && mode === "translation" ? (
          <TranslationComparePanel
            translation={translationState.data}
            loading={translationState.isLoading}
            error={translationState.isError ? translationState.error : null}
            editing={translationEditing}
            editContent={content}
            editorExtensions={editorExtensions}
            onEditContentChange={setContent}
            tagEditor={
              translationSourceKind === "tags"
                ? {
                    projectId,
                    assetId,
                    tags: tagDraft,
                    taggerSource: tagsDocument.data?.tagger_source ?? null,
                    fontSize,
                    dirty: tagsDirty,
                    readOnly: translationEditing || writePending,
                    onChange: setTagDraft,
                    onFontSizeChange: setFontSize,
                  }
                : undefined
            }
            dictionaryPreview={dictionaryPreview.data}
            dictionaryPreviewLoading={dictionaryPreview.isResolving}
            dictionaryPreviewError={dictionaryPreview.isError ? dictionaryPreview.error : undefined}
          />
        ) : assetId ? (
          <CodeMirror
            className="annotation-editor__codemirror"
            value={content}
            height="100%"
            maxHeight="100%"
            extensions={editorExtensions}
            onChange={setContent}
            placeholder={
              mode === "existing_annotation"
                ? "这里存放迁移时确认存在的旧 TXT，也可以继续人工修订。"
                : "LLM 返回的描述会进入这里；校验通过后可直接用于翻译和导出。"
            }
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
          />
        ) : (
          <div className="annotation-editor__empty">选择图片后可查看各标注通道。</div>
        )}
      </div>

      <footer className="annotation-editor__footer">
        {actionError ? <span className="validation-warning">{actionError}</span> : null}
        {mode === "translation" ? (
          <>
            <span>
              {translationSourceKind === "tags" ? "Tags 对照" : "描述对照"} ·{" "}
              {translationProducerKind === "local_dictionary" ? "本地词典" : "LLM"}
            </span>
            <span>
              {dictionaryPreview.data || translationState.data?.alignment_status === "aligned"
                ? "支持悬停与划词联动"
                : "当前未启用文本联动"}
            </span>
          </>
        ) : (
          <>
            <span>
              {mode === "tags" ? `${tagCount} 个 Tag` : `${content.length.toLocaleString()} 字符`}
            </span>
            <span>{AVAILABILITY_LABELS[activeAvailabilityStatus]}</span>
            {activeReviewStatus ? <span>{REVIEW_LABELS[activeReviewStatus]}</span> : null}
            {document.data?.source ? (
              <span>{revisionSourceLabel(document.data.source)}</span>
            ) : null}
            {!dirty && document.data?.validation?.issues.length ? (
              <span className="validation-warning">
                <TriangleAlert size={12} /> {document.data.validation.issues[0].message}
              </span>
            ) : null}
          </>
        )}
        <span className="annotation-editor__shortcut">
          {fontSize}px · Ctrl+滚轮调整字号
          {mode !== "translation" || translationEditing || tagsDirty ? " · Ctrl+S 保存" : ""}
        </span>
      </footer>
    </section>
  );
}
