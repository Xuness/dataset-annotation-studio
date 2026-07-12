import { useEffect, useMemo, useState } from "react";
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

export function AnnotationEditor({ projectId, assetId, onDirtyChange }: AnnotationEditorProps) {
  const annotation = useAnnotation(projectId, assetId);
  const save = useSaveAnnotation(projectId, assetId ?? "");
  const remove = useDeleteAnnotation(projectId, assetId ?? "");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");

  const dirty = content !== savedContent;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

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

  const extensions = useMemo(() => [xml()], []);

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

      <div className="annotation-editor__body">
        {assetId ? (
          <CodeMirror
            value={content}
            height="100%"
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
        <span className="annotation-editor__shortcut">Ctrl+S 保存</span>
      </footer>
    </section>
  );
}
