import { useState } from "react";

import type {
  AnnotationBatchContent,
  AnnotationStageScope,
} from "../../../../../pages/spaces/spacePageModel";
import { AnnotationBatchSurface } from "../workcells/edit/AnnotationBatchSurface";

interface AnnotationStageContextDockProps {
  scope: AnnotationStageScope;
  batch: AnnotationBatchContent | null;
  totalCount: number;
  checkedCount: number;
  onOpenProduction(): void;
}

export function AnnotationStageContextDock({
  scope,
  batch,
  totalCount,
  checkedCount,
  onOpenProduction,
}: AnnotationStageContextDockProps) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"scope" | "batch">("scope");

  return (
    <aside
      className={`dial-archive-stage-context-dock${open ? " is-open" : ""}`}
      data-stage-camera-lock
      aria-label="素材范围台"
    >
      <button
        className="dial-archive-stage-context-dock__trigger"
        type="button"
        data-summary={checkedCount ? `${checkedCount} 已选` : "当前素材"}
        data-action={open ? "收起" : "展开"}
        aria-expanded={open}
        aria-controls="annotation-stage-context-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span>RANGE DOCK</span>
        <b>{checkedCount ? `${checkedCount} 已选` : "当前素材"}</b>
        <em>{open ? "收起" : "展开"}</em>
      </button>

      {open ? (
        <div className="dial-archive-stage-context-dock__panel" id="annotation-stage-context-panel">
          <button
            className="dial-archive-stage-context-dock__scrim"
            type="button"
            aria-label="关闭素材范围台"
            onClick={() => setOpen(false)}
          />
          <section>
            <header>
              <div>
                <span>CONTEXT DOCK // MATERIAL RANGE</span>
                <h2>素材范围台</h2>
              </div>
              <b>{String(checkedCount || 1).padStart(4, "0")}</b>
              <button type="button" aria-label="关闭素材范围台" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>

            <nav aria-label="范围台页面">
              <button
                className={panel === "scope" ? "is-active" : undefined}
                type="button"
                onClick={() => setPanel("scope")}
              >
                <span>01</span>
                <b>范围与筛选</b>
              </button>
              <button
                className={panel === "batch" ? "is-active" : undefined}
                type="button"
                onClick={() => setPanel("batch")}
              >
                <span>02</span>
                <b>批量施工</b>
              </button>
            </nav>

            <div className="dial-archive-stage-context-dock__body">
              {panel === "scope" ? (
                <div className="dial-archive-stage-context-dock__scope">
                  <label>
                    <span>FIND MATERIAL</span>
                    <input
                      type="search"
                      value={scope.search}
                      placeholder="文件名 / 相对路径"
                      onChange={(event) => scope.setSearch(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>OBJECT STATE</span>
                    <select
                      value={scope.filter}
                      onChange={(event) =>
                        scope.setFilter(event.target.value as AnnotationStageScope["filter"])
                      }
                    >
                      {scope.filters.map((filter) => (
                        <option value={filter.id} key={filter.id}>
                          {filter.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <dl>
                    <div>
                      <dt>VISIBLE RANGE</dt>
                      <dd>{totalCount.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>EXPLICIT RANGE</dt>
                      <dd>{checkedCount.toLocaleString()}</dd>
                    </div>
                  </dl>
                  <div className="dial-archive-stage-context-dock__scope-actions">
                    <button
                      type="button"
                      disabled={!totalCount || scope.selectingAll}
                      onClick={() => void scope.selectAllFiltered()}
                    >
                      {scope.selectingAll ? "正在读取" : "选择全部筛选结果"}
                    </button>
                    <button type="button" disabled={!checkedCount} onClick={scope.clearChecked}>
                      清除显式范围
                    </button>
                  </div>
                  {scope.actionError ? <p role="alert">{scope.actionError}</p> : null}
                </div>
              ) : batch ? (
                <AnnotationBatchSurface batch={batch} />
              ) : (
                <div className="dial-archive-stage-context-dock__empty" role="status">
                  <span>BATCH CONTRACT</span>
                  <b>范围控制器尚未装载</b>
                </div>
              )}
            </div>

            <footer>
              <span>SHIFT + CLICK 扩展连续范围 · ALT + CLICK 切换单项</span>
              <button
                className="is-primary"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenProduction();
                }}
              >
                交给自动生产 →
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
