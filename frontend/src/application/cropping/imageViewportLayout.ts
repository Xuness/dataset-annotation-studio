interface ImageView {
  zoom: number;
  x: number;
  y: number;
}

/** Layout offsets avoid transformed image-layer tile seams in WebKitGTK. */
export function imageViewportLayout(width: number, height: number, view: ImageView) {
  const halfWidth = `min(${view.zoom * 50}cqw, ${(width / height) * view.zoom * 50}cqh)`;
  const halfHeight = `min(${(height / width) * view.zoom * 50}cqw, ${view.zoom * 50}cqh)`;
  return {
    width: `min(${view.zoom * 100}cqw, ${(width / height) * view.zoom * 100}cqh)`,
    height: `min(${(height / width) * view.zoom * 100}cqw, ${view.zoom * 100}cqh)`,
    left: `calc(50% - ${halfWidth} + ${view.x}px)`,
    top: `calc(50% - ${halfHeight} + ${view.y}px)`,
  };
}
