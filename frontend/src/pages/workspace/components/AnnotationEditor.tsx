import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { BadgeCheck, FileText, History, Save, Trash2, TriangleAlert } from "lucide-react";

import {
  useAnnotationBundle,
  useAnnotationChannel,
  useAnnotationChannelHistory,
  useDeleteAnnotationChannel,
  useReviewAnnotationChannel,
  useSaveAnnotationChannel,
} from "../../../features/annotations/hooks";
import { useTranslation, useTranslations } from "../../../features/translations/hooks";
import type {
  AnnotationChannel,
  AnnotationDocument,
  AnnotationTag,
} from "../../../shared/api/types";
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { AnnotationHistoryPanel } from "./AnnotationHistoryPanel";
import {
  AVAILABILITY_LABELS,
  REVIEW_LABELS,
  revisionSourceLabel,
  TRANSLATION_STATUS_LABELS,
} from "./annotationLabels";
import {
  draftToTags,
  hasExistingAnnotationDocument,
  reconcilePersistedContent,
  tagsToDraft,
} from "./annotationEditorState";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onActiveTargetChange: (target: { channel: AnnotationChannel; language: string }) => void;
}

type EditorMode = AnnotationChannel | "compare";

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";
const DEFAULT_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko"];
const EXISTING_ANNOTATION_TAB = { value: "existing_annotation", label: "原有标注" } as const;
const DEFAULT_CHANNEL_TABS: Array<{ value: EditorMode; label: string }> = [
  { value: "tags", label: "Tags" },
  { value: "description", label: "LLM 描述" },
  { value: "translation", label: "翻译" },
  { value: "compare", label: "对照" },
];
function readFontSize(): number {
  const stored = Number.parseInt(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? "12", 10);
  return Number.isFinite(stored) ? Math.min(22, Math.max(10, stored)) : 12;
}

function documentDraft(document: AnnotationDocument | undefined): string {
  if (!document) return "";
  return document.content_kind === "tags" ? tagsToDraft(document.tags) : document.content;
}

export function AnnotationEditor({
  projectId,
  assetId,
  onDirtyChange,
  onActiveTargetChange,
}: AnnotationEditorProps) {
  const [mode, setMode] = useState<EditorMode>("description");
  const [language, setLanguage] = useState("zh-CN");
  const activeChannel: AnnotationChannel = mode === "compare" ? "description" : mode;
  const activeLanguage = activeChannel === "translation" ? language : "";
  const bundle = useAnnotationBundle(projectId, assetId);
  const document = useAnnotationChannel(projectId, assetId, activeChannel, activeLanguage);
  const compareTranslation = useAnnotationChannel(projectId, assetId, "translation", language);
  const translations = useTranslations(projectId, assetId);
  const translationState = useTranslation(projectId, assetId, language);
  const save = useSaveAnnotationChannel(projectId, assetId ?? "", activeChannel, activeLanguage);
  const review = useReviewAnnotationChannel(
    projectId,
    assetId ?? "",
    activeChannel,
    activeLanguage,
  );
  const remove = useDeleteAnnotationChannel(
    projectId,
    assetId ?? "",
    activeChannel,
    activeLanguage,
  );
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [tagDraftBasis, setTagDraftBasis] = useState<AnnotationTag[]>([]);
  const [restoredTagMetadata, setRestoredTagMetadata] = useState(false);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [showHistory, setShowHistory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dirty =
    mode !== "compare" &&
    (content !== savedContent || (activeChannel === "tags" && restoredTagMetadata));
  const dirtyRef = useRef(dirty);
  const loadedDocumentKey = useRef("");
  dirtyRef.current = dirty;
  const history = useAnnotationChannelHistory(
    projectId,
    assetId,
    activeChannel,
    activeLanguage,
    showHistory && mode !== "compare",
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_LANGUAGES, ...(translations.data?.map((item) => item.language) ?? [])]),
      ),
    [translations.data],
  );
  const hasExistingAnnotation = hasExistingAnnotationDocument(bundle.data?.documents);
  const channelTabs = useMemo(
    () =>
      hasExistingAnnotation
        ? [EXISTING_ANNOTATION_TAB, ...DEFAULT_CHANNEL_TABS]
        : DEFAULT_CHANNEL_TABS,
    [hasExistingAnnotation],
  );

  useUnsavedScope(`annotation:${projectId}`, dirty);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(
    () => onActiveTargetChange({ channel: activeChannel, language: activeLanguage }),
    [activeChannel, activeLanguage, onActiveTargetChange],
  );

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    const key = `${assetId ?? ""}:${activeChannel}:${activeLanguage}`;
    if (!assetId) {
      loadedDocumentKey.current = key;
      setContent("");
      setSavedContent("");
      setSavedRevisionId(null);
      setTagDraftBasis([]);
      setRestoredTagMetadata(false);
      return;
    }
    if (!document.data || mode === "compare") return;
    if (loadedDocumentKey.current !== key || !dirtyRef.current) {
      const next = documentDraft(document.data);
      loadedDocumentKey.current = key;
      setContent(next);
      setSavedContent(next);
      setSavedRevisionId(document.data.head_revision_id);
      setTagDraftBasis(document.data.tags);
      setRestoredTagMetadata(false);
    }
  }, [activeChannel, activeLanguage, assetId, document.data, mode]);

  useEffect(() => {
    if (
      mode !== "existing_annotation" ||
      bundle.isLoading ||
      hasExistingAnnotation ||
      dirtyRef.current
    ) {
      return;
    }
    loadedDocumentKey.current = "";
    setContent("");
    setSavedContent("");
    setSavedRevisionId(null);
    setTagDraftBasis([]);
    setRestoredTagMetadata(false);
    setMode("description");
  }, [bundle.isLoading, hasExistingAnnotation, mode]);

  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (assetId && dirty && !save.isPending) {
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
  const editorExtensions = useMemo(
    () => (activeChannel === "tags" ? commonExtensions : [xml(), ...commonExtensions]),
    [activeChannel, commonExtensions],
  );

  function channelState(channel: AnnotationChannel, targetLanguage = "") {
    const item = bundle.data?.documents.find(
      (item) => item.channel === channel && (item.language ?? "") === targetLanguage,
    );
    if (!item || item.availability_status === "missing") return undefined;
    if (item.availability_status !== "usable") return item.availability_status;
    return item.review_status === "reviewed" ? "reviewed" : "usable";
  }

  async function changeMode(next: EditorMode) {
    if (next === mode) return;
    if (dirty) {
      const discard = await confirmDialog("当前通道有尚未保存的修改。确定放弃后切换吗？", {
        title: "切换标注通道",
        tone: "danger",
        confirmLabel: "放弃并切换",
      });
      if (!discard) return;
    }
    loadedDocumentKey.current = "";
    setContent("");
    setSavedContent("");
    setSavedRevisionId(null);
    setTagDraftBasis([]);
    setRestoredTagMetadata(false);
    setActionError(null);
    setShowHistory(false);
    setMode(next);
  }

  async function changeLanguage(next: string) {
    if (next === language) return;
    if (dirty) {
      const discard = await confirmDialog("当前译文有尚未保存的修改。确定放弃后切换吗？", {
        title: "切换译文语言",
        tone: "danger",
        confirmLabel: "放弃并切换",
      });
      if (!discard) return;
    }
    loadedDocumentKey.current = "";
    setContent("");
    setSavedContent("");
    setSavedRevisionId(null);
    setTagDraftBasis([]);
    setRestoredTagMetadata(false);
    setLanguage(next);
  }

  async function handleSaveClick() {
    if (!assetId || mode === "compare") return;
    const submittedContent = content;
    setActionError(null);
    try {
      const result = await save.mutateAsync(
        activeChannel === "tags"
          ? {
              tags: draftToTags(submittedContent, tagDraftBasis),
              expectedHeadRevisionId: savedRevisionId,
            }
          : {
              content: submittedContent,
              expectedHeadRevisionId: savedRevisionId,
            },
      );
      const persisted = documentDraft(result);
      setContent((current) => reconcilePersistedContent(current, submittedContent, persisted));
      setSavedContent(persisted);
      setSavedRevisionId(result.head_revision_id);
      setTagDraftBasis(result.tags);
      setRestoredTagMetadata(false);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "保存标注失败。");
    }
  }

  async function handleReview() {
    if (!savedRevisionId || dirty) return;
    setActionError(null);
    try {
      if (activeChannel === "translation" && translationStatus === "stale") {
        const result = await save.mutateAsync({
          content,
          expectedHeadRevisionId: savedRevisionId,
          review: true,
        });
        const persisted = documentDraft(result);
        setContent(persisted);
        setSavedContent(persisted);
        setSavedRevisionId(result.head_revision_id);
      } else {
        const result = await review.mutateAsync(savedRevisionId);
        setSavedRevisionId(result.head_revision_id);
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "复核标注失败。");
    }
  }

  async function handleDelete() {
    if (!assetId || !document.data?.exists || mode === "compare") return;
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
      setContent("");
      setSavedContent("");
      setSavedRevisionId(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除标注失败。");
    }
  }

  function restoreRevision(revisionContent: string, tags: AnnotationTag[]) {
    if (activeChannel === "tags") {
      setContent(tagsToDraft(tags));
      setTagDraftBasis(tags);
      setRestoredTagMetadata(true);
    } else {
      setContent(revisionContent);
    }
    setShowHistory(false);
  }

  function readonlyEditor(value: string, placeholder: string) {
    return (
      <CodeMirror
        className="annotation-editor__codemirror annotation-editor__codemirror--readonly"
        value={value}
        height="100%"
        maxHeight="100%"
        extensions={[xml(), ...commonExtensions]}
        editable={false}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
    );
  }

  const compareSource =
    bundle.data?.documents.find(
      (item) =>
        item.channel === "description" && item.exists && item.availability_status === "usable",
    ) ??
    bundle.data?.documents.find(
      (item) =>
        item.channel === "existing_annotation" &&
        item.exists &&
        item.availability_status === "usable",
    );
  const translationStatus = translationState.data?.status;
  const translationNeedsSourceRefresh =
    activeChannel === "translation" && translationStatus === "stale";
  const activeAvailabilityStatus = document.data?.availability_status ?? "missing";
  const activeReviewStatus = document.data?.review_status;
  const tagCount = draftToTags(content, tagDraftBasis).length;

  return (
    <section className="annotation-editor" data-surface-region="content">
      <header className="annotation-editor__header">
        <div className="annotation-editor__title">
          <FileText size={15} />
          <strong>数据库标注</strong>
          {mode !== "compare" ? (
            <>
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
            </>
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
              const tabStatus =
                tab.value === "compare"
                  ? undefined
                  : channelState(tab.value, tab.value === "translation" ? language : "");
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
          {mode === "translation" || mode === "compare" ? (
            <select
              className="annotation-language-select"
              aria-label="译文语言"
              value={language}
              onChange={(event) => void changeLanguage(event.target.value)}
            >
              {languageOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="annotation-editor__actions">
          {mode !== "compare" ? (
            <>
              <Button
                icon={<History size={14} />}
                onClick={() => setShowHistory((current) => !current)}
                disabled={!assetId}
              >
                历史
              </Button>
              <Button
                tone="danger"
                icon={<Trash2 size={14} />}
                onClick={() => void handleDelete()}
                disabled={!document.data?.exists || remove.isPending}
              >
                删除
              </Button>
              <Button
                icon={review.isPending ? <Spinner /> : <BadgeCheck size={14} />}
                onClick={() => void handleReview()}
                disabled={
                  !document.data?.exists ||
                  dirty ||
                  (document.data.review_status === "reviewed" &&
                    document.data.availability_status !== "stale" &&
                    !translationNeedsSourceRefresh) ||
                  review.isPending ||
                  save.isPending
                }
              >
                标记已复核
              </Button>
              <Button
                tone="primary"
                icon={save.isPending ? <Spinner /> : <Save size={14} />}
                onClick={() => void handleSaveClick()}
                disabled={!assetId || !dirty || save.isPending}
              >
                保存
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div
        className="annotation-editor__body"
        style={{ "--annotation-font-size": `${fontSize}px` } as CSSProperties}
      >
        {assetId && document.isLoading && mode !== "compare" ? (
          <div className="annotation-editor__empty">
            <Spinner label="读取标注通道" />
          </div>
        ) : assetId && document.isError && !document.data && mode !== "compare" ? (
          <div className="annotation-editor__empty validation-warning">
            无法读取标注：
            {document.error instanceof Error ? document.error.message : "未知错误"}
          </div>
        ) : assetId && showHistory && mode !== "compare" ? (
          <AnnotationHistoryPanel
            activeChannel={activeChannel}
            revisions={history.data}
            loading={history.isLoading}
            error={history.isError ? history.error : null}
            onRestore={restoreRevision}
          />
        ) : assetId && mode !== "compare" ? (
          <CodeMirror
            className="annotation-editor__codemirror"
            value={content}
            height="100%"
            maxHeight="100%"
            extensions={editorExtensions}
            onChange={setContent}
            placeholder={
              activeChannel === "tags"
                ? "输入逗号或换行分隔的 Tags。保存后会立即成为当前可用版本。"
                : activeChannel === "existing_annotation"
                  ? "这里存放迁移时确认存在的旧 TXT，也可以继续人工修订。"
                  : activeChannel === "description"
                    ? "LLM 返回的描述会进入这里；校验通过后可直接用于翻译和导出。"
                    : `输入或修订 ${language} 译文。`
            }
            basicSetup={{
              lineNumbers: activeChannel !== "tags",
              foldGutter: activeChannel !== "tags",
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
          />
        ) : assetId && mode === "compare" ? (
          <div className="annotation-editor__compare">
            <section>
              <header>
                <strong>{compareSource?.display_name ?? "源标注"}</strong>
                <small>
                  {compareSource
                    ? `${AVAILABILITY_LABELS[compareSource.availability_status]} · ${
                        compareSource.review_status
                          ? REVIEW_LABELS[compareSource.review_status]
                          : "未复核"
                      }`
                    : "缺失"}
                </small>
              </header>
              <div>{readonlyEditor(compareSource?.content ?? "", "当前没有可用源标注。")}</div>
            </section>
            <section>
              <header>
                <strong>{language} 译文</strong>
                <small>
                  {translationStatus ? TRANSLATION_STATUS_LABELS[translationStatus] : ""}
                </small>
              </header>
              <div>
                {compareTranslation.isLoading ? (
                  <div className="annotation-editor__empty">
                    <Spinner label="读取译文" />
                  </div>
                ) : (
                  readonlyEditor(compareTranslation.data?.content ?? "", "当前没有译文。")
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="annotation-editor__empty">选择图片后可查看各标注通道。</div>
        )}
      </div>

      <footer className="annotation-editor__footer">
        {actionError ? <span className="validation-warning">{actionError}</span> : null}
        {mode !== "compare" ? (
          <>
            <span>
              {activeChannel === "tags"
                ? `${tagCount} 个 Tag`
                : `${content.length.toLocaleString()} 字符`}
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
        ) : (
          <span>对照视图只读；源标注优先使用当前可用的 LLM 描述，其次使用原有标注。</span>
        )}
        <span className="annotation-editor__shortcut">
          {fontSize}px · Ctrl+滚轮调整字号
          {mode !== "compare" ? " · Ctrl+S 保存" : ""}
        </span>
      </footer>
    </section>
  );
}
