import { useEffect, useMemo, useState, type CSSProperties } from "react";
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

import { useAnnotationEditorController } from "../../../application/annotations/useAnnotationEditorController";
import {
  DEFAULT_TOKENIZATION_PROFILE_ID,
  TOKENIZATION_PROFILE_IDS,
} from "../../../features/tokenization/profiles";
import { legacyConfirm } from "../../../legacy/legacyInteractions";
import type {
  AnnotationChannel,
  AnnotationChannelTarget,
  TokenizationProfileId,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { AnnotationHistoryPanel } from "./AnnotationHistoryPanel";
import {
  AVAILABILITY_LABELS,
  REVIEW_LABELS,
  revisionSourceLabel,
  TRANSLATION_STATUS_LABELS,
} from "./annotationLabels";
import { TagEditorPanel } from "./TagEditorPanel";
import { TokenCountBadges, TokenProfileSelect } from "./TokenizationControls";
import { TranslationComparePanel } from "./TranslationComparePanel";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean, kind: "tags" | "annotation" | null) => void;
  onActiveTargetChange: (target: AnnotationChannelTarget) => void;
}

type EditorMode = AnnotationChannel;

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";
const TOKEN_PROFILE_STORAGE_KEY = "dataset-studio.tokenization-profile";
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

function readTokenizationProfile(): TokenizationProfileId {
  const stored = window.localStorage.getItem(TOKEN_PROFILE_STORAGE_KEY);
  return TOKENIZATION_PROFILE_IDS.includes(stored as TokenizationProfileId)
    ? (stored as TokenizationProfileId)
    : DEFAULT_TOKENIZATION_PROFILE_ID;
}

export function AnnotationEditor({
  projectId,
  assetId,
  onDirtyChange,
  onActiveTargetChange,
}: AnnotationEditorProps) {
  const [fontSize, setFontSize] = useState(readFontSize);
  const [tokenProfileId, setTokenProfileId] = useState(readTokenizationProfile);
  const controller = useAnnotationEditorController({
    projectId,
    assetId,
    tokenProfileId,
    confirm: legacyConfirm,
    onDirtyChange,
    onActiveTargetChange,
  });
  const {
    mode,
    language,
    translationSourceKind,
    translationProducerKind,
    document,
    tagsDocument,
    translationState,
    history,
    content,
    setContent,
    tagDraft,
    setTagDraft,
    translationEditing,
    setTranslationEditing,
    showHistory,
    setShowHistory,
    actionError,
    descriptionTokenCounts,
    tagEditingActive,
    tagsDirty,
    dirty,
    languageOptions,
    hasExistingAnnotation,
    dictionaryPreview,
    channelState,
    changeMode,
    changeLanguage,
    changeTranslationSource,
    changeTranslationProducer,
    cancelTranslationEdit,
    cancelTagChanges,
    saveTagDraft,
    retryLocalDictionaryRefresh,
    saveContent,
    reviewContent,
    deleteContent,
    restoreRevision,
    translationStatus,
    activeAvailabilityStatus,
    activeReviewStatus,
    translationReviewBlocked,
    translationReadOnly,
    tagWritePending,
    writePending,
    canRefreshLocalDictionary,
    tagCount,
    deletePending,
    reviewPending,
    refreshLocalDictionaryPending,
  } = controller;

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    window.localStorage.setItem(TOKEN_PROFILE_STORAGE_KEY, tokenProfileId);
  }, [tokenProfileId]);

  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (assetId && dirty && !writePending) void saveContent();
      }
    }
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [assetId, dirty, saveContent, writePending]);

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
  const channelTabs = useMemo(
    () =>
      hasExistingAnnotation
        ? [EXISTING_ANNOTATION_TAB, ...DEFAULT_CHANNEL_TABS]
        : DEFAULT_CHANNEL_TABS,
    [hasExistingAnnotation],
  );

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
            onClick={() => void deleteContent()}
            disabled={!document.data?.exists || dirty || deletePending || writePending}
          >
            删除
          </Button>
          <Button
            icon={reviewPending ? <Spinner /> : <BadgeCheck size={14} />}
            onClick={() => void reviewContent()}
            disabled={
              !document.data?.exists ||
              dirty ||
              translationReviewBlocked ||
              (document.data.review_status === "reviewed" &&
                document.data.availability_status !== "stale") ||
              reviewPending ||
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
                {canRefreshLocalDictionary || refreshLocalDictionaryPending ? (
                  <Button
                    icon={refreshLocalDictionaryPending ? <Spinner /> : <RefreshCw size={14} />}
                    onClick={() => void retryLocalDictionaryRefresh()}
                    disabled={refreshLocalDictionaryPending}
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
                  onClick={() => void saveContent()}
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
              onClick={() => void saveContent()}
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
            tokenProfileId={tokenProfileId}
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
            <span className="annotation-editor__token-tools">
              <TokenProfileSelect value={tokenProfileId} onChange={setTokenProfileId} />
            </span>
          </>
        ) : (
          <>
            <span>
              {mode === "tags" ? `${tagCount} 个 Tag` : `${content.length.toLocaleString()} 字符`}
            </span>
            {mode === "description" && assetId ? (
              <span className="annotation-editor__token-tools">
                <TokenProfileSelect value={tokenProfileId} onChange={setTokenProfileId} />
                <TokenCountBadges
                  profileId={tokenProfileId}
                  itemId="description"
                  query={descriptionTokenCounts}
                />
              </span>
            ) : null}
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
