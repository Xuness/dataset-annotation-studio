import type { AnnotationEditHistory } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationEditHistoryDrawerProps {
  history: AnnotationEditHistory;
}

function formatRevisionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString();
}

export function AnnotationEditHistoryDrawer({ history }: AnnotationEditHistoryDrawerProps) {
  if (!history.open) return null;

  return (
    <aside className="dial-archive-edit-history" aria-label="当前通道修订记录">
      <header>
        <div>
          <span>REVISION FOLIO // CURRENT CHANNEL</span>
          <h3>修订记录</h3>
        </div>
        <button type="button" aria-label="关闭修订记录" onClick={history.toggle}>
          ×
        </button>
      </header>

      <div className="dial-archive-edit-history__rail" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="dial-archive-edit-history__list">
        {history.status === "loading" ? (
          <div className="dial-archive-edit-history__state">
            <span>READING REVISION REGISTER</span>
            <b>正在读取历史版本</b>
          </div>
        ) : null}
        {history.status === "error" ? (
          <div className="dial-archive-edit-history__state is-error">
            <span>REGISTER FAILURE</span>
            <b>{history.message ?? "读取历史失败。"}</b>
          </div>
        ) : null}
        {history.status === "ready" && !history.entries.length ? (
          <div className="dial-archive-edit-history__state">
            <span>REVISION REGISTER // EMPTY</span>
            <b>当前通道还没有历史版本</b>
          </div>
        ) : null}
        {history.entries.map((entry, index) => (
          <article
            className={`${entry.candidate ? "is-candidate" : ""}${entry.tombstone ? " is-tombstone" : ""}`}
            key={entry.id}
          >
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{entry.sourceLabel}</b>
                <time dateTime={entry.createdAt}>{formatRevisionTime(entry.createdAt)}</time>
              </div>
              {entry.candidate ? <em>CANDIDATE</em> : null}
            </header>
            <pre>{entry.preview}</pre>
            <button
              type="button"
              disabled={!entry.restorable}
              onClick={() => history.restore(entry.id)}
            >
              <span>{entry.restorable ? "RESTORE TO DESK" : "READ ONLY"}</span>
              <b>{entry.restorable ? "恢复到编辑面" : "不可恢复"}</b>
            </button>
          </article>
        ))}
      </div>
    </aside>
  );
}
