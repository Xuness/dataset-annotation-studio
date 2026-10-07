import { ImageIcon, Maximize2 } from "lucide-react";
import type { AssetSummary } from "../../../src/shared/api/types";
import type { CharacterAudit } from "../../../src/shared/api/contracts/characterAudits";
import { membershipLabel } from "../../../src/application/characterAudits/characterMembership";
import { imageViewportLayout } from "../../../src/application/cropping/imageViewportLayout";
import { useCropViewport } from "../../../src/application/cropping/useCropViewport";
import { imageUrl } from "../../../src/features/assets/api";
import { Button } from "../../shared/ui/Button";

export function CharacterImagePreview({
  project,
  asset,
  operation,
  profileIndex,
}: {
  project: string;
  asset: AssetSummary | null;
  operation: CharacterAudit | null;
  profileIndex: number;
}) {
  const { viewport, view, spaceHeld, panning, fit, handlers } = useCropViewport();
  return (
    <section className="character-image-pane" data-testid="character-image-pane">
      <header>
        <span className="eyebrow">Selected material</span>
        <h2>{asset?.filename ?? "选择素材"}</h2>
        {asset && (
          <p>
            {asset.width} × {asset.height} · 图片浏览不会改变角色参考图
          </p>
        )}
      </header>
      {asset && operation && (
        <p className="character-membership-note" data-testid="character-image-membership">
          {membershipLabel(operation, profileIndex, asset.id)}
        </p>
      )}
      <div className="crop-canvas-tools">
        <span>{Math.round(view.zoom * 100)}%</span>
        <Button icon={<Maximize2 size={14} />} data-testid="character-image-fit" onClick={fit}>
          适应窗口
        </Button>
      </div>
      <div
        ref={viewport}
        {...handlers}
        tabIndex={0}
        aria-label="角色参考预览，滚轮缩放，空格加左键拖图"
        className={`crop-canvas-viewport character-image-viewport${spaceHeld ? " is-space-held" : ""}${panning ? " is-panning" : ""}`}
        data-testid="character-image-viewport"
      >
        {asset ? (
          <div
            className="crop-canvas-image"
            style={imageViewportLayout(asset.width, asset.height, view)}
          >
            <img
              data-testid="character-selected-image"
              src={imageUrl(project, asset.id, asset.content_version)}
              alt={asset.filename}
              draggable={false}
            />
          </div>
        ) : (
          <div className="character-image-empty">
            <ImageIcon size={28} />
            <p>从左侧选择图片查看，或调整素材筛选范围</p>
          </div>
        )}
      </div>
      <p className="crop-canvas-help">滚轮缩放 · 空格 + 左键自由拖动 · 只读预览</p>
    </section>
  );
}
