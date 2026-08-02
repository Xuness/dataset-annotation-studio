import type { FocusEvent, MutableRefObject } from "react";

import type { DialArchiveSpace } from "../../model/spacePresentation";

interface WorkspaceIndexProps {
  spaces: readonly DialArchiveSpace[];
  selectedIndex: number;
  previewIndex: number | null;
  rowRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  onPointerPreview(index: number | null): void;
  onFocusPreview(index: number | null): void;
  onCommit(index: number): void;
}

export function WorkspaceIndex({
  spaces,
  selectedIndex,
  previewIndex,
  rowRefs,
  onPointerPreview,
  onFocusPreview,
  onCommit,
}: WorkspaceIndexProps) {
  const handlePointerLeave = () => onPointerPreview(null);
  const handleFocusOut = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onFocusPreview(null);
  };

  return (
    <nav
      className="dial-archive-index"
      aria-label="一级空间索引"
      onPointerLeave={handlePointerLeave}
      onBlur={handleFocusOut}
    >
      <div className="dial-archive-index__header">
        <div className="dial-archive-index__kicker">PRIMARY SPACES</div>
        <div className="dial-archive-index__title">
          <strong>WORKSPACES</strong>
          <span>工作空间 · INDEX / 06</span>
        </div>
      </div>

      <div className="dial-archive-index__list">
        {spaces.map((space, index) => {
          const selected = index === selectedIndex;
          const previewed = index === previewIndex && !selected;
          const classNames = [
            "dial-archive-index__row",
            selected ? "is-selected" : "",
            previewed ? "is-previewed" : "",
            space.separated ? "is-separated" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              className={classNames}
              key={space.id}
              type="button"
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              aria-label={`预览并锁定空间 ${space.index} ${space.label}`}
              aria-pressed={selected}
              data-space-id={space.id}
              onPointerEnter={() => onPointerPreview(index)}
              onFocus={() => onFocusPreview(index)}
              onClick={() => onCommit(index)}
            >
              <span className="dial-archive-index__row-surface">
                <span className="dial-archive-index__row-index">
                  <span>{space.index}</span>
                </span>
                <span className="dial-archive-index__row-copy">
                  <span className="dial-archive-index__row-en">{space.englishLabel}</span>
                  <span className="dial-archive-index__row-cn">{space.label}</span>
                </span>
                <span className="dial-archive-index__row-state">{space.code}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="dial-archive-index__footer">
        <span>POINTER / PREVIEW</span>
        <strong>
          {spaces[previewIndex ?? selectedIndex].index} //{" "}
          {previewIndex === null ? "LOCKED" : "PREVIEW"}
        </strong>
      </div>
    </nav>
  );
}
