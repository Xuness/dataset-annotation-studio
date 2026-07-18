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
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean) => void;
}

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";
const REVISION_SOURCE_LABELS: Record<string, string> = {
  manual_edit: "手动保存",
  model_response: "模型生成",
  manual_accept: "人工采用",
  deleted_snapshot: "删除前快照",
};

function readFontSize(): number {
  const stored = Number.parseInt(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? "12", 10);
  return Number.isFinite(stored) ? Math.min(22, Math.max(10, stored)) : 12;
}

export function AnnotationEditor({ projectId, assetId, onDirtyChange }: AnnotationEditorProps) {
  const annotation = useAnnotation(projectId, assetId);
  const save = useSaveAnnotation(projectId, assetId ?? "");
  const remove = useDeleteAnnotation(projectId, assetId ?? "");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fontSize, setFontSize] = useState(readFontSize);
  const [showHistory, setShowHistory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const history = useAnnotationHistory(projectId, assetId, showHistory);

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
    setActionError(null);
    try {
      const result = await save.mutateAsync(content);
      setContent(result.content);
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
    setActionError(null);
    try {
      await remove.mutateAsync();
      setContent("");
      setSavedContent("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除标注失败。");
    }
  }

  function restoreRevision(revisionContent: string) {
    setContent(revisionContent);
    setShowHistory(false);
  }

  return (
    <section className="annotation-editor">
      <header className="annotation-editor__header">
        <div className="annotation-editor__title">
          <FileText size={15} />
          <strong>标注文本</strong>
          {annotation.data ? <StatusDot status={annotation.data.status} showLabel /> : null}
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>
        <div className="annotation-editor__actions">
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
        ) : assetId && showHistory ? (
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
        ) : assetId ? (
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
        ) : (
          <div className="annotation-editor__empty">选择图片后可查看和编辑同名 .txt</div>
        )}
      </div>

      <footer className="annotation-editor__footer">
        {actionError ? <span className="validation-warning">{actionError}</span> : null}
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
        <span className="annotation-editor__shortcut">
          {fontSize}px · Ctrl+滚轮调整字号 · Ctrl+S 保存
        </span>
      </footer>
    </section>
  );
}
