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
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenProduction(): void;
}

export function AnnotationStageContextDock({
  scope,
  batch,
  totalCount,
  checkedCount,
  open,
  onOpenChange,
  onOpenProduction,
}: AnnotationStageContextDockProps) {
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
        onClick={() => onOpenChange(!open)}
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
            onClick={() => onOpenChange(false)}
          />
          <section data-panel={panel}>
            <header>
              <div>
                <span>
                  {panel === "scope"
                    ? "03.A // MATERIAL SCOPE ROUTER"
                    : "03.B // BATCH CONSTRUCTION"}
                </span>
                <h2>{panel === "scope" ? "素材范围台" : "批量施工台"}</h2>
              </div>
              <b>{panel === "scope" ? "03.A" : "03.B"}</b>
              <button type="button" aria-label="关闭素材范围台" onClick={() => onOpenChange(false)}>
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
                  <section
                    className="dial-archive-stage-context-dock__scope-summary"
                    aria-label="当前素材范围摘要"
                  >
                    <span>ACTIVE MATERIAL SCOPE</span>
                    <h3>
                      {checkedCount
                        ? "显式选取范围"
                        : scope.folderPaths.length
                          ? "多目录素材范围"
                          : "项目全局范围"}
                    </h3>
                    <strong>{(checkedCount || totalCount).toLocaleString()}</strong>
                    <small>
                      {checkedCount
                        ? "后续批量施工只处理显式选中的素材。"
                        : scope.folderPaths.length
                          ? `${scope.folderPaths.length.toLocaleString()} 个目录分支已合并为当前素材序列。`
                          : "当前胶片轨道读取项目中的全部有效素材。"}
                    </small>
                    <dl>
                      <div>
                        <dt>DIRECTORY SET</dt>
                        <dd>{scope.folderPaths.length.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>EXPLICIT RANGE</dt>
                        <dd>{checkedCount.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </section>
                  <div className="dial-archive-stage-context-dock__query">
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
                  </div>
                  <section className="dial-archive-stage-context-dock__directory">
                    <div className="dial-archive-stage-context-dock__directory-intro">
                      <span>DIRECTORY BRANCH</span>
                      <b>素材目录集合</b>
                      <small>可同时启用多个分支；胶片、搜索与全选使用合并去重后的素材范围。</small>
                    </div>
                    <div
                      className="dial-archive-stage-context-dock__directory-choices"
                      role="group"
                      aria-label="素材目录分支"
                    >
                      <button
                        className={scope.folderPaths.length === 0 ? "is-active" : undefined}
                        type="button"
                        aria-label="使用整个项目素材范围"
                        aria-pressed={scope.folderPaths.length === 0}
                        disabled={scope.folderLoading}
                        onClick={scope.clearFolderPaths}
                      >
                        <span>
                          <b>整个项目</b>
                          <small>ROOT / GLOBAL RANGE</small>
                        </span>
                        <strong>ALL</strong>
                      </button>
                      {scope.folderOptions.map((folder) => {
                        const selected = scope.folderPaths.includes(folder.id);
                        return (
                          <button
                            className={selected ? "is-active" : undefined}
                            type="button"
                            aria-label={`切换素材目录 ${folder.detail}`}
                            aria-pressed={selected}
                            disabled={scope.folderLoading}
                            onClick={() => scope.toggleFolderPath(folder.id)}
                            key={folder.id}
                          >
                            <span>
                              <b>{folder.label}</b>
                              <small>{folder.detail}</small>
                            </span>
                            <strong>{folder.count.toLocaleString()}</strong>
                          </button>
                        );
                      })}
                    </div>
                    <label className="dial-archive-stage-context-dock__recursive">
                      <input
                        type="checkbox"
                        checked={scope.recursiveScan}
                        disabled={scope.recursivePending}
                        onChange={(event) => scope.setRecursiveScan(event.target.checked)}
                      />
                      <span>
                        <b>{scope.recursivePending ? "正在更新索引" : "递归索引子文件夹"}</b>
                        <small>关闭后，重新扫描只保留工作目录根层素材。</small>
                      </span>
                    </label>
                  </section>
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
                    {scope.actionError ? <p role="alert">{scope.actionError}</p> : null}
                  </div>
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
              <span>
                {panel === "scope"
                  ? "SHIFT + 左键 连续选择/取消 · CTRL + 左键 单项选择/取消"
                  : "批量变更先生成证据预览，确认后才允许写入"}
              </span>
              <button
                className="is-primary"
                type="button"
                onClick={() => {
                  onOpenChange(false);
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
