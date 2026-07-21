import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { FileText, History, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";

import {
  useAnnotation,
  useAnnotationHistory,
  useDeleteAnnotation,
  useSaveAnnotation,
} from "../../../features/annotations/hooks";
import { useTranslation, useTranslations } from "../../../features/translations/hooks";
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { reconcilePersistedContent } from "./annotationEditorState";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean) => void;
}

type EditorMode = "source" | "translation" | "compare";

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";
const REVISION_SOURCE_LABELS: Record<string, string> = {
  manual_edit: "手动保存",
  model_response: "模型生成",
  manual_accept: "人工采用",
  deleted_snapshot: "删除前快照",
};
const DEFAULT_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko"];
const TRANSLATION_STATUS_LABELS = {
  missing: "尚无译文",
  current: "译文最新",
  stale: "译文已过期",
  untracked: "外部译文",
  source_missing: "缺少源标注",
  source_invalid: "源标注编码异常",
  conflict: "文件名冲突",
} as const;

function readFontSize(): number {
  const stored = Number.parseInt(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? "12", 10);
  return Number.isFinite(stored) ? Math.min(22, Math.max(10, stored)) : 12;
}

export function AnnotationEditor({ projectId, assetId, onDirtyChange }: AnnotationEditorProps) {
  const annotation = useAnnotation(projectId, assetId);
  const save = useSaveAnnotation(projectId, assetId ?? "");
  const remove = useDeleteAnnotation(projectId, assetId ?? "");
  const translations = useTranslations(projectId, assetId);
  const [language, setLanguage] = useState("zh-CN");
  const translation = useTranslation(projectId, assetId, language);
  const [mode, setMode] = useState<EditorMode>("source");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fontSize, setFontSize] = useState(readFontSize);
  const [showHistory, setShowHistory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const history = useAnnotationHistory(projectId, assetId, showHistory);
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_LANGUAGES, ...(translations.data?.map((item) => item.language) ?? [])]),
      ),
    [translations.data],
  );

  const dirty = content !== savedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedScope(`annotation:${projectId}`, dirty);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    if (dirtyRef.current) return;
    if (annotation.data) {
      setContent(annotation.data.content);
      setSavedContent(annotation.data.content);
    } else if (!assetId) {
      setContent("");
      setSavedContent("");
    }
  }, [annotation.data, assetId]);

  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (assetId && dirty && !save.isPending) void handleSaveClick();
      }
    }
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  });

  const extensions = useMemo(
    () => [
      xml(),
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

  async function handleSaveClick() {
    if (!assetId) return;
    const submittedContent = content;
    setActionError(null);
    try {
      const result = await save.mutateAsync(submittedContent);
      setContent((current) => reconcilePersistedContent(current, submittedContent, result.content));
      setSavedContent(result.content);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "保存标注失败。");
    }
  }

  async function handleDelete() {
    if (!assetId || !annotation.data?.exists) return;
    const confirmed = await confirmDialog("删除当前图片旁的同名标注文件？内部历史仍会保留。", {
      title: "删除标注",
      tone: "danger",
      confirmLabel: "删除",
    });
    if (!confirmed) return;
    const contentBeforeDelete = content;
    setActionError(null);
    try {
      await remove.mutateAsync();
      setContent((current) => reconcilePersistedContent(current, contentBeforeDelete, ""));
      setSavedContent("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除标注失败。");
    }
  }

  function restoreRevision(revisionContent: string) {
    setContent(revisionContent);
    setShowHistory(false);
  }

  function readonlyEditor(value: string, placeholder: string) {
    return (
      <CodeMirror
        className="annotation-editor__codemirror annotation-editor__codemirror--readonly"
        value={value}
        height="100%"
        maxHeight="100%"
        extensions={extensions}
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

  const translationStatus = translation.data?.status;
  const translationUnavailable =
    !translation.data?.exists ||
    translation.data.status === "source_missing" ||
    translation.data.status === "source_invalid" ||
    translation.data.status === "conflict";

  return (
    <section className="annotation-editor">
      <header className="annotation-editor__header">
        <div className="annotation-editor__title">
          <FileText size={15} />
          <strong>标注与译文</strong>
          {mode === "source" && annotation.data ? (
            <StatusDot status={annotation.data.status} showLabel />
          ) : null}
          {mode !== "source" && translationStatus ? (
            <span className={`translation-status translation-status--${translationStatus}`}>
              {TRANSLATION_STATUS_LABELS[translationStatus]}
            </span>
          ) : null}
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>
        <div className="annotation-editor__view-controls">
          <div className="annotation-view-tabs">
            <button
              className={mode === "source" ? "is-active" : ""}
              onClick={() => {
                setMode("source");
                setShowHistory(false);
              }}
            >
              原文
            </button>
            <button
              className={mode === "translation" ? "is-active" : ""}
              onClick={() => {
                setMode("translation");
                setShowHistory(false);
              }}
            >
              译文
            </button>
            <button
              className={mode === "compare" ? "is-active" : ""}
              onClick={() => {
                setMode("compare");
                setShowHistory(false);
              }}
            >
              对照
            </button>
          </div>
          {mode !== "source" ? (
            <select
              className="annotation-language-select"
              aria-label="译文语言"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
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
          {mode === "source" ? (
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
                disabled={!annotation.data?.exists || remove.isPending}
              >
                删除
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
        {assetId && annotation.isLoading ? (
          <div className="annotation-editor__empty">
            <Spinner label="读取标注" />
          </div>
        ) : assetId && annotation.isError && !annotation.data ? (
          <div className="annotation-editor__empty validation-warning">
            无法读取标注：
            {annotation.error instanceof Error ? annotation.error.message : "未知错误"}
          </div>
        ) : assetId && showHistory && mode === "source" ? (
          <div className="annotation-editor__history">
            {history.isLoading ? <Spinner label="读取历史" /> : null}
            {history.isError ? (
              <p className="validation-warning">
                {history.error instanceof Error ? history.error.message : "读取历史失败。"}
              </p>
            ) : null}
            {history.data?.map((revision) => (
              <article key={revision.id}>
                <header>
                  <div>
                    <strong>{REVISION_SOURCE_LABELS[revision.source] ?? revision.source}</strong>
                    <small>{new Date(revision.created_at).toLocaleString()}</small>
                  </div>
                  <Button
                    icon={<RotateCcw size={12} />}
                    onClick={() => restoreRevision(revision.content)}
                  >
                    恢复到编辑器
                  </Button>
                </header>
                <pre>{revision.content}</pre>
              </article>
            ))}
            {!history.isLoading && !history.data?.length ? <p>当前还没有历史版本。</p> : null}
          </div>
        ) : assetId && mode === "source" ? (
          <CodeMirror
            className="annotation-editor__codemirror"
            value={content}
            height="100%"
            maxHeight="100%"
            extensions={extensions}
            onChange={setContent}
            placeholder="当前图片还没有标注。你可以在这里手动填写，或稍后创建批量标注任务。"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
          />
        ) : assetId && mode === "translation" ? (
          translation.isLoading ? (
            <div className="annotation-editor__empty">
              <Spinner label="读取译文" />
            </div>
          ) : translation.isError && !translation.data ? (
            <div className="annotation-editor__empty validation-warning">
              无法读取译文：
              {translation.error instanceof Error ? translation.error.message : "未知错误"}
            </div>
          ) : translationUnavailable ? (
            <div className="annotation-editor__empty annotation-editor__translation-empty">
              <strong>{TRANSLATION_STATUS_LABELS[translation.data?.status ?? "missing"]}</strong>
              <span>
                {translation.data?.issue ?? `在任务页选择素材并创建 ${language} 翻译任务。`}
              </span>
            </div>
          ) : (
            readonlyEditor(translation.data?.content ?? "", "当前没有译文。")
          )
        ) : assetId && mode === "compare" ? (
          <div className="annotation-editor__compare">
            <section>
              <header>
                <strong>原文</strong>
                <small>{annotation.data?.path}</small>
              </header>
              <div>{readonlyEditor(content, "当前没有源标注。")}</div>
            </section>
            <section>
              <header>
                <strong>{language} 译文</strong>
                <small>{translation.data?.path}</small>
              </header>
              <div>
                {translation.isLoading ? (
                  <div className="annotation-editor__empty">
                    <Spinner label="读取译文" />
                  </div>
                ) : translationUnavailable ? (
                  <div className="annotation-editor__empty">尚无可对照的译文</div>
                ) : (
                  readonlyEditor(translation.data?.content ?? "", "当前没有译文。")
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="annotation-editor__empty">选择图片后可查看和编辑同名 .txt</div>
        )}
      </div>

      <footer className="annotation-editor__footer">
        {actionError ? <span className="validation-warning">{actionError}</span> : null}
        {mode === "source" ? (
          <>
            <span>{content.length.toLocaleString()} 字符</span>
            {dirty ? (
              <span>保存后重新校验标签</span>
            ) : (
              <span>{annotation.data?.validation?.tag_count ?? 0} 个标签</span>
            )}
            {!dirty && annotation.data?.validation?.issues.length ? (
              <span className="validation-warning">
                <TriangleAlert size={12} /> {annotation.data.validation.issues[0].message}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span>{translation.data?.content.length.toLocaleString() ?? 0} 个译文字符</span>
            <span>{translation.data?.path ?? `*.${language}.txt`}</span>
            {dirty ? (
              <span className="translation-stale-warning">原文尚未保存；保存后现有译文会过期</span>
            ) : null}
            {translation.data?.provider_profile_name ? (
              <span>
                {translation.data.provider_profile_name} · {translation.data.model}
              </span>
            ) : null}
          </>
        )}
        <span className="annotation-editor__shortcut">
          {fontSize}px · Ctrl+滚轮调整字号
          {mode === "source" ? " · Ctrl+S 保存" : " · 译文只读"}
        </span>
      </footer>
    </section>
  );
}
