import { useCropSource } from "../../../src/features/cropping/hooks";

interface Props {
  projectId: string;
  assetId: string;
}
export function CropSourceInfo({ projectId, assetId }: Props) {
  const query = useCropSource(projectId, assetId);
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return null;
  const { item, operation_id } = query.data;
  return (
    <section className="overview-card" data-testid="crop-source-info">
      <h3>裁剪来源</h3>
      <dl>
        <dt>源图片</dt>
        <dd>{item.source_path}</dd>
        <dt>原图版本</dt>
        <dd style={{ overflowWrap: "anywhere" }}>{item.source_hash}</dd>
        <dt>原生像素区域</dt>
        <dd>
          {item.rectangle.x}, {item.rectangle.y} · {item.rectangle.width}×{item.rectangle.height}
        </dd>
        <dt>生成操作</dt>
        <dd style={{ overflowWrap: "anywhere" }}>{operation_id}</dd>
      </dl>
    </section>
  );
}
