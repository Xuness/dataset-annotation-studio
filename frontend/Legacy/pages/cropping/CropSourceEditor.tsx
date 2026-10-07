import { useState, type ReactNode } from "react";
import { Plus, Trash2, LocateFixed } from "lucide-react";
import type { Ratio } from "../../../src/shared/api/types";
import { removeFirstRegion } from "../../../src/application/cropping/workbenchState";
import { centeredRect } from "../../../src/application/cropping/geometry";
import type { CropWorkbenchController } from "../../../src/application/cropping/useCropWorkbench";
import { Button } from "../../shared/ui/Button";
import { CropCanvas } from "./CropCanvas";
import { CropCoordinates } from "./CropCoordinates";
import { CropPosition } from "./CropPosition";
import { CropSourceResult } from "./CropOverview";
import { RatioControl } from "./RatioControl";

interface Props {
  projectId: string;
  controller: CropWorkbenchController;
  controls: ReactNode;
  history: ReactNode;
}
export function CropSourceEditor({ projectId, controller: c, controls, history }: Props) {
  const [nextRatio, setNextRatio] = useState<Ratio | null>(null);
  const [revision, setRevision] = useState(0);
  const [ratioReset, setRatioReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const draft = c.current;
  if (!draft) return null;
  const { source, regions, selected } = draft;
  const current = regions[selected]?.rectangle;
  const ratio = current ? current.ratio : nextRatio;
  const disabled = c.unavailable || !c.currentInScope || Boolean(draft.sourceError);
  function validity(valid: boolean) {
    c.updateCurrent((value) => ({ ...value, invalid: !valid }));
  }
  function changeRatio(value: Ratio | null) {
    try {
      if (current) {
        const resized = centeredRect(current.width, current.height, value);
        c.changeRectangles(
          regions.map((region, index) =>
            index === selected ? { ...resized, x: current.x, y: current.y } : region.rectangle,
          ),
        );
      }
      setNextRatio(value);
      setRevision((v) => v + 1);
      validity(true);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      validity(false);
      return false;
    }
  }
  return (
    <section className="crop-inline-editor" data-testid="crop-editor">
      <div className="crop-editor">
        <div className="crop-editor-main" data-testid="crop-center-scroll">
          {controls}
          <div className="crop-editor-heading">
            <strong>{source.filename}</strong>
            <span>
              {source.width} × {source.height} · 原图保持不变
            </span>
          </div>
          {!c.currentInScope && (
            <p className="crop-description" data-testid="crop-outside-scope">
              当前素材不在处理范围内，仅供浏览；请在左栏勾选或调整处理范围后裁剪。
            </p>
          )}
          <CropCanvas
            projectId={projectId}
            asset={source}
            interaction={c.mode === "batch" ? "position" : "regions"}
            rectangles={regions.map((region) => region.rectangle)}
            selected={selected}
            ratio={ratio}
            disabled={disabled}
            onSelect={(index) => c.updateCurrent((value) => ({ ...value, selected: index }))}
            onChange={(rectangles) => {
              c.changeRectangles(rectangles);
              setRevision((v) => v + 1);
            }}
          />
          {history}
        </div>
        <aside className="crop-inspector" data-testid="crop-inspector-scroll">
          {c.mode === "single" ? (
            <>
              <header className="crop-inspector-heading">
                <span className="eyebrow">Regions</span>
                <h3>
                  裁剪区域 <span>{regions.length}</span>
                </h3>
              </header>
              <div className="crop-actions">
                <Button
                  icon={<Plus size={14} />}
                  data-testid="crop-add-frame"
                  disabled={disabled}
                  onClick={() => {
                    c.changeRectangles([
                      ...regions.map((region) => region.rectangle),
                      centeredRect(source.width, source.height, ratio),
                    ]);
                    c.updateCurrent((value) => ({ ...value, selected: value.regions.length - 1 }));
                  }}
                >
                  新增裁剪框
                </Button>
                <Button
                  icon={<Trash2 size={14} />}
                  data-testid="crop-delete-frame"
                  disabled={disabled || !regions.length}
                  title="按列表从上往下逐个删除，无需选择"
                  onClick={() => {
                    c.updateCurrent(removeFirstRegion);
                    setRevision((value) => value + 1);
                  }}
                >
                  删除首个框
                </Button>
              </div>
              <ol className="crop-frame-list">
                {regions.map((region, index) => (
                  <li key={region.id}>
                    <Button
                      data-testid={`crop-select-${index}`}
                      aria-pressed={index === selected}
                      disabled={disabled}
                      onClick={() => {
                        c.updateCurrent((value) => ({ ...value, selected: index }));
                        setRevision((v) => v + 1);
                      }}
                    >
                      框 {index + 1} · {region.rectangle.width} × {region.rectangle.height}
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="crop-actions">
                <Button
                  data-testid="crop-free-ratio"
                  aria-pressed={ratio === null}
                  disabled={disabled}
                  onClick={() => changeRatio(null)}
                >
                  自由比例
                </Button>
                <Button
                  data-testid="crop-lock-ratio"
                  aria-pressed={ratio !== null}
                  disabled={disabled}
                  onClick={() => changeRatio({ width: 1, height: 1 })}
                >
                  锁定比例
                </Button>
              </div>
              {ratio && (
                <RatioControl
                  key={regions[selected]?.id ?? "new"}
                  resetEpoch={ratioReset}
                  ratio={ratio}
                  disabled={disabled}
                  onChange={changeRatio}
                  onValidity={validity}
                />
              )}
              {current && (
                <CropCoordinates
                  key={`coordinates-${selected}-${revision}`}
                  rectangle={current}
                  width={source.width}
                  height={source.height}
                  disabled={disabled}
                  onValidity={validity}
                  onChange={(rect) =>
                    c.changeRectangles(
                      regions.map((region, index) =>
                        index === selected ? rect : region.rectangle,
                      ),
                    )
                  }
                />
              )}
              {!regions.length && (
                <p className="crop-description">
                  在画布拖动框选，或新增裁剪框；每个区域生成一张独立图片。
                </p>
              )}
            </>
          ) : (
            <>
              <header className="crop-inspector-heading">
                <span className="eyebrow">Position</span>
                <h3>调整当前图片</h3>
              </header>
              <p className="crop-description">
                直接拖动裁剪框调整位置，保持统一比例的最大尺寸，不影响其他图片。
              </p>
              {current && (
                <CropPosition
                  key={`${revision}-${c.state.ratioRevision}`}
                  rectangle={current}
                  width={source.width}
                  height={source.height}
                  disabled={disabled}
                  onChange={(rect) => c.changeRectangles([rect])}
                  onValidity={validity}
                />
              )}
              <Button
                icon={<LocateFixed size={14} />}
                data-testid="crop-recenter"
                disabled={disabled}
                onClick={() => {
                  c.centerCurrent();
                  setRevision((v) => v + 1);
                }}
              >
                恢复居中
              </Button>
            </>
          )}
          {draft.invalid && (
            <div className="form-error" role="alert">
              有无效参数，请修正或恢复最后有效坐标。
              <Button
                data-testid="crop-restore-valid"
                disabled={disabled}
                onClick={() => {
                  validity(true);
                  setRatioReset((value) => value + 1);
                  setRevision((v) => v + 1);
                }}
              >
                恢复有效参数
              </Button>
            </div>
          )}
          {draft.sourceError && (
            <div className="form-error" role="alert">
              {draft.sourceError}
              <Button
                data-testid="crop-reload-source"
                disabled={c.busy}
                onClick={() => void c.reloadCurrent()}
              >
                重新载入源图
              </Button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <details className="crop-current-preview" open>
            <summary>当前图片输出预览</summary>
            <CropSourceResult projectId={projectId} draft={draft} />
          </details>
        </aside>
      </div>
    </section>
  );
}
