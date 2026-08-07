import type { AnnotationBatchContent } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationBatchSurfaceProps {
  batch: AnnotationBatchContent;
}

export function AnnotationBatchSurface({ batch }: AnnotationBatchSurfaceProps) {
  const tags = batch.tags;
  const deletion = batch.deletion;
  return (
    <div className="dial-archive-batch-surface">
      <header>
        <div>
          <span>ACTIVE RANGE // EXPLICIT SCOPE</span>
          <h3>{batch.rangeCount} 张素材待批量施工</h3>
        </div>
        <b>{String(batch.rangeCount).padStart(4, "0")}</b>
      </header>
      <div className="dial-archive-batch-surface__body">
        <section className="dial-archive-batch-surface__tags">
          <header>
            <span>04.A / TAGS BATCH EDIT</span>
            <h4>Tags 批量变更</h4>
          </header>
          <nav aria-label="批量 Tags 操作模式">
            {(["add", "remove", "replace"] as const).map((mode) => (
              <button
                className={tags.mode === mode ? "is-active" : undefined}
                type="button"
                disabled={tags.busy}
                onClick={() => tags.setMode(mode)}
                key={mode}
              >
                {mode === "add" ? "添加" : mode === "remove" ? "移除" : "替换"}
                <small>{mode.toUpperCase()}</small>
              </button>
            ))}
          </nav>
          <div className="dial-archive-batch-surface__inputs">
            {tags.mode === "add" ? (
              <label>
                <span>ADD TAGS</span>
                <textarea
                  value={tags.addDraft}
                  placeholder="tag_a, tag_b"
                  onChange={(event) => tags.setAddDraft(event.target.value)}
                />
              </label>
            ) : tags.mode === "remove" ? (
              <label>
                <span>REMOVE TAGS</span>
                <textarea
                  value={tags.removeDraft}
                  placeholder="tag_a, tag_b"
                  onChange={(event) => tags.setRemoveDraft(event.target.value)}
                />
              </label>
            ) : (
              <>
                <label>
                  <span>SOURCE TAG</span>
                  <input
                    value={tags.sourceDraft}
                    onChange={(event) => tags.setSourceDraft(event.target.value)}
                  />
                </label>
                <label>
                  <span>REPLACEMENT</span>
                  <input
                    value={tags.replacementDraft}
                    onChange={(event) => tags.setReplacementDraft(event.target.value)}
                  />
                </label>
              </>
            )}
            {tags.mode === "add" ? (
              <div className="dial-archive-batch-surface__position">
                <label>
                  <span>INSERT POSITION</span>
                  <select
                    value={tags.insertPosition}
                    onChange={(event) =>
                      tags.setInsertPosition(event.target.value as typeof tags.insertPosition)
                    }
                  >
                    <option value="end">末尾</option>
                    <option value="start">开头</option>
                    <option value="index">指定序号</option>
                    <option value="before">锚点之前</option>
                    <option value="after">锚点之后</option>
                  </select>
                </label>
                {tags.insertPosition === "index" ? (
                  <label>
                    <span>INDEX</span>
                    <input
                      inputMode="numeric"
                      value={tags.insertIndex}
                      onChange={(event) => tags.setInsertIndex(event.target.value)}
                    />
                  </label>
                ) : tags.insertPosition === "before" || tags.insertPosition === "after" ? (
                  <label>
                    <span>ANCHOR TAG</span>
                    <input
                      value={tags.insertAnchor}
                      onChange={(event) => tags.setInsertAnchor(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
          <p>{tags.modeDescription}</p>
          {tags.requestError ? (
            <strong className="is-error">{tags.requestError}</strong>
          ) : tags.notice ? (
            <strong>{tags.notice}</strong>
          ) : null}
          <footer>
            <button
              type="button"
              disabled={!tags.canPreview}
              onClick={() => void tags.previewChanges()}
            >
              {tags.busy ? "正在计算" : "生成变更预览"}
            </button>
            <button
              className="is-primary"
              type="button"
              disabled={!tags.canExecute}
              onClick={() => void tags.executeChanges()}
            >
              执行已预览变更
            </button>
          </footer>
        </section>
        <section className="dial-archive-batch-surface__preview">
          <header>
            <span>04.B / CHANGE PROOF</span>
            <h4>变更证据</h4>
          </header>
          {tags.preview ? (
            <>
              <dl>
                <div>
                  <dt>REQUESTED</dt>
                  <dd>{tags.preview.requestedCount}</dd>
                </div>
                <div>
                  <dt>CHANGED</dt>
                  <dd>{tags.preview.changedCount}</dd>
                </div>
                <div>
                  <dt>UNCHANGED</dt>
                  <dd>{tags.preview.unchangedCount}</dd>
                </div>
                <div>
                  <dt>SKIPPED</dt>
                  <dd>{tags.preview.positionSkippedCount}</dd>
                </div>
              </dl>
              <div className="dial-archive-batch-surface__preview-list">
                {tags.preview.items.map((item) => (
                  <article className={item.changed ? "is-changed" : undefined} key={item.id}>
                    <header>
                      <b>{item.filename}</b>
                      <span>
                        {item.positionSkipped
                          ? "ANCHOR MISSED"
                          : item.changed
                            ? "CHANGE"
                            : "UNCHANGED"}
                      </span>
                    </header>
                    <p>
                      <del>{item.before || "∅"}</del>
                      <ins>{item.after || "∅"}</ins>
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="dial-archive-batch-surface__empty">
              <span>PREVIEW REQUIRED</span>
              <b>先生成预览，再允许写入</b>
            </div>
          )}
        </section>
        <aside className="dial-archive-batch-surface__delete">
          <header>
            <span>04.C / CHANNEL RETIRE</span>
            <h4>批量删除标注</h4>
          </header>
          <p>删除活动通道但保留历史修订。未选通道不会发生变化。</p>
          {deletion.status === "loading" ? (
            <div className="dial-archive-batch-surface__empty">正在统计可删除通道…</div>
          ) : (
            <div className="dial-archive-batch-surface__delete-list">
              {deletion.options.map((option) => (
                <button
                  className={option.selected ? "is-selected" : undefined}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => deletion.toggle(option.id)}
                  key={option.id}
                >
                  <i />
                  <span>
                    <b>{option.label}</b>
                    <small>
                      {option.activeCount} ACTIVE / {option.staleCount} STALE
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {deletion.actionError ? (
            <strong className="is-error">{deletion.actionError}</strong>
          ) : deletion.notice ? (
            <strong>{deletion.notice}</strong>
          ) : null}
          <footer>
            <button
              type="button"
              disabled={!deletion.options.length || deletion.busy}
              onClick={deletion.toggleAll}
            >
              全选通道
            </button>
            <button
              className="is-danger"
              type="button"
              disabled={!deletion.selectedCount || deletion.busy}
              onClick={() => void deletion.execute()}
            >
              删除 {deletion.selectedCount || ""} 类标注
            </button>
          </footer>
        </aside>
      </div>
    </div>
  );
}
