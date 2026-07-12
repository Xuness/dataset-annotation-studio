import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { FileText, Save, Trash2, TriangleAlert } from "lucide-react";

import {
  useAnnotation,
  useDeleteAnnotation,
  useSaveAnnotation,
} from "../../../features/annotations/hooks";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";

interface AnnotationEditorProps {
  projectId: string;
  assetId: string | null;
  onDirtyChange: (dirty: boolean) => void;
}

const FONT_SIZE_STORAGE_KEY = "dataset-studio.annotation-font-size";

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

  const dirty = content !== savedContent;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
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
    const result = await save.mutateAsync(content);
    setSavedContent(result.content);
  }

  async function handleDelete() {
    if (!assetId || !annotation.data?.exists) return;
    if (!window.confirm("删除当前图片旁的同名标注文件？内部历史仍会保留。")) return;
    await remove.mutateAsync();
    setContent("");
    setSavedContent("");
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
        {assetId ? (
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
        <span>{content.length.toLocaleString()} 字符</span>
        <span>{annotation.data?.validation?.tag_count ?? 0} 个标签</span>
        {annotation.data?.validation?.issues.length ? (
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
