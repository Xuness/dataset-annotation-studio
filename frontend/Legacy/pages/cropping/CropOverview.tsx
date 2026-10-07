import { ChevronLeft, ChevronRight } from "lucide-react";
import { imageUrl } from "../../../src/features/assets/api";
import {
  pendingRegion,
  sourceStatus,
  type SourceDraft,
} from "../../../src/application/cropping/workbenchState";
import type { CropWorkbenchController } from "../../../src/application/cropping/useCropWorkbench";
import { Button } from "../../shared/ui/Button";
import { cropStatusLabels } from "./cropLabels";

export function CropSourceResult({ projectId, draft }: { projectId: string; draft: SourceDraft }) {
  const source = draft.source;
  const url = imageUrl(projectId, source.id, source.content_version);
  return (
    <div className="crop-result-images">
      <figure>
        <svg viewBox={`0 0 ${source.width} ${source.height}`} aria-label="原图与裁剪区域">
          <image href={url} width={source.width} height={source.height} />
          {draft.regions.map((region) => (
            <rect
              key={region.id}
              {...{
                x: region.rectangle.x,
                y: region.rectangle.y,
                width: region.rectangle.width,
                height: region.rectangle.height,
              }}
              className="crop-overview-frame"
            />
          ))}
        </svg>
        <figcaption>原图 · {draft.regions.length ? "裁剪范围" : "尚未配置区域"}</figcaption>
      </figure>
      {draft.regions.map((region, index) => {
        const rect = region.rectangle;
        return (
          <figure key={region.id}>
            <svg
              viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`}
              aria-label={`区域 ${index + 1} 输出预览`}
            >
              <image href={url} width={source.width} height={source.height} />
            </svg>
            <figcaption>
              框 {index + 1} · {rect.width} × {rect.height} ·{" "}
              {region.failure ? "失败" : pendingRegion(draft, region) ? "待生成" : "已生成"}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
export function CropOverview({
  projectId,
  controller: c,
}: {
  projectId: string;
  controller: CropWorkbenchController;
}) {
  const page = c.state.overviewPage;
  const pages = Math.max(1, Math.ceil(c.sources.length / 24));
  return (
    <section className="crop-overview" data-testid="crop-overview">
      <div className="crop-overview-grid">
        {c.sources.slice(page * 24, (page + 1) * 24).map((draft, index) => (
          <button
            type="button"
            className="crop-overview-card"
            key={draft.source.id}
            data-testid={`crop-overview-${draft.source.id}`}
            disabled={c.busy}
            onClick={() => c.selectSource(draft.source.id)}
          >
            <header>
              <span>{String(page * 24 + index + 1).padStart(2, "0")}</span>
              <strong title={draft.source.relative_path}>{draft.source.filename}</strong>
            </header>
            <CropSourceResult projectId={projectId} draft={draft} />
            <footer>
              <span className={`crop-status crop-status--${sourceStatus(draft)}`}>
                {cropStatusLabels[sourceStatus(draft)]}
              </span>
              <span>点击图片编辑 →</span>
            </footer>
          </button>
        ))}
      </div>
      {pages > 1 && (
        <div className="crop-pagination">
          <Button
            data-testid="crop-overview-previous"
            icon={<ChevronLeft size={14} />}
            disabled={!page}
            onClick={() => c.patch({ overviewPage: page - 1 })}
          >
            上一页
          </Button>
          <span>
            {page + 1} / {pages} · {c.sources.length} 张源图
          </span>
          <Button
            data-testid="crop-overview-next"
            icon={<ChevronRight size={14} />}
            disabled={page + 1 === pages}
            onClick={() => c.patch({ overviewPage: page + 1 })}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
