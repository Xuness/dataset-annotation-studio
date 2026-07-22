import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { DEFAULT_INTERFACE_SCALE, useInterfaceScale } from "../desktop/useInterfaceScale";

export function InterfaceScaleControl() {
  const scale = useInterfaceScale();

  return (
    <div className="interface-scale-control" role="group" aria-label="界面缩放">
      <button
        type="button"
        onClick={scale.decrease}
        disabled={!scale.canDecrease}
        title="缩小界面"
        aria-label="缩小界面"
      >
        <ZoomOut size={14} />
      </button>
      <span title="当前界面缩放比例">{Math.round(scale.scale * 100)}%</span>
      <button
        type="button"
        onClick={scale.increase}
        disabled={!scale.canIncrease}
        title="放大界面"
        aria-label="放大界面"
      >
        <ZoomIn size={14} />
      </button>
      <button
        type="button"
        onClick={scale.reset}
        disabled={scale.scale === DEFAULT_INTERFACE_SCALE}
        title={`恢复 ${Math.round(DEFAULT_INTERFACE_SCALE * 100)}%`}
        aria-label="恢复默认界面缩放"
      >
        <RotateCcw size={13} />
      </button>
    </div>
  );
}
