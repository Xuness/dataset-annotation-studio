import { RotateCcw } from "lucide-react";

import type {
  AnnotationChannel,
  AnnotationRevision,
  AnnotationTag,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { revisionSourceLabel } from "./annotationLabels";
import { tagsToDraft } from "./annotationEditorState";

interface AnnotationHistoryPanelProps {
  activeChannel: AnnotationChannel;
  revisions: AnnotationRevision[] | undefined;
  loading: boolean;
  error: unknown;
  onRestore: (content: string, tags: AnnotationTag[]) => void;
}

export function AnnotationHistoryPanel({
  activeChannel,
  revisions,
  loading,
  error,
  onRestore,
}: AnnotationHistoryPanelProps) {
  return (
    <div className="annotation-editor__history">
      {loading ? <Spinner label="读取历史" /> : null}
      {error ? (
        <p className="validation-warning">
          {error instanceof Error ? error.message : "读取历史失败。"}
        </p>
      ) : null}
      {revisions?.map((revision) => (
        <article key={revision.id} className={revision.is_candidate ? "is-candidate" : ""}>
          <header>
            <div>
              <strong>{revisionSourceLabel(revision.source)}</strong>
              <small>
                {new Date(revision.created_at).toLocaleString()}
                {revision.is_candidate ? " · 候选版本" : ""}
              </small>
            </div>
            <Button
              icon={<RotateCcw size={12} />}
              onClick={() => onRestore(revision.content, revision.tags)}
              disabled={revision.is_tombstone}
            >
              恢复到编辑器
            </Button>
          </header>
          <pre>
            {revision.is_tombstone
              ? "已删除"
              : activeChannel === "tags"
                ? tagsToDraft(revision.tags)
                : revision.content}
          </pre>
        </article>
      ))}
      {!loading && !revisions?.length ? <p>当前通道还没有历史版本。</p> : null}
    </div>
  );
}
