import {
  closeDialArchiveWindow,
  dialArchiveUsesCustomTitlebar,
  minimizeDialArchiveWindow,
  toggleDialArchiveWindowMaximized,
} from "../model/dialArchiveWindow";

type WindowControlKind = "minimize" | "maximize" | "close";

function WindowControlIcon({ kind }: { kind: WindowControlKind }) {
  return <span className={`dial-archive-chrome__window-icon is-${kind}`} aria-hidden="true" />;
}

export function DialArchiveWindowControls() {
  if (!dialArchiveUsesCustomTitlebar()) {
    return (
      <span className="dial-archive-chrome__window-glyphs" aria-hidden="true">
        <WindowControlIcon kind="minimize" />
        <WindowControlIcon kind="maximize" />
        <WindowControlIcon kind="close" />
      </span>
    );
  }

  return (
    <span className="dial-archive-chrome__window-controls">
      <button type="button" aria-label="最小化窗口" onClick={minimizeDialArchiveWindow}>
        <WindowControlIcon kind="minimize" />
      </button>
      <button type="button" aria-label="切换最大化窗口" onClick={toggleDialArchiveWindowMaximized}>
        <WindowControlIcon kind="maximize" />
      </button>
      <button type="button" aria-label="关闭窗口" onClick={closeDialArchiveWindow}>
        <WindowControlIcon kind="close" />
      </button>
    </span>
  );
}

export function DialArchiveBarcode({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 34 11" aria-hidden="true">
      <rect x="0" width="2" height="11" />
      <rect x="4" width="1" height="11" />
      <rect x="7" width="3" height="11" />
      <rect x="12" width="1" height="11" />
      <rect x="15" width="2" height="11" />
      <rect x="19" width="1" height="11" />
      <rect x="22" width="4" height="11" />
      <rect x="28" width="1" height="11" />
      <rect x="31" width="2" height="11" />
    </svg>
  );
}
