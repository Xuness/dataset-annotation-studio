import { useMemo, useRef, type UIEvent } from "react";

import type { AnnotationEditContent } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationEditTextSurfaceProps {
  edit: AnnotationEditContent;
  code: string;
  title: string;
  readOnly?: boolean;
}

export function AnnotationEditTextSurface({
  edit,
  code,
  title,
  readOnly = false,
}: AnnotationEditTextSurfaceProps) {
  const lineRailRef = useRef<HTMLOListElement>(null);
  const lines = useMemo(
    () => Array.from({ length: edit.lineCount }, (_, index) => index + 1),
    [edit.lineCount],
  );

  function syncLineRail(event: UIEvent<HTMLTextAreaElement>) {
    if (lineRailRef.current) {
      lineRailRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
    }
  }

  return (
    <section className="dial-archive-edit-text" aria-label={`${title}编辑器`}>
      <header>
        <div>
          <span>{code} // TEXT PLANE</span>
          <b>{title}</b>
        </div>
        <div aria-label="文本读数">
          <span>{edit.lineCount.toLocaleString()} LINE</span>
          <span>{edit.characterCount.toLocaleString()} CHAR</span>
          {edit.tokenMetrics.map((metric) => (
            <span title={metric.label} key={metric.id}>
              {metric.shortLabel.toUpperCase()} {metric.count.toLocaleString()}
            </span>
          ))}
          {edit.tokenMetricsPending ? <span>COUNTING…</span> : null}
        </div>
      </header>

      <div className="dial-archive-edit-text__plane">
        <div className="dial-archive-edit-text__ruler" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <aside aria-hidden="true">
          <ol ref={lineRailRef}>
            {lines.map((line) => (
              <li key={line}>{String(line).padStart(3, "0")}</li>
            ))}
          </ol>
        </aside>
        <textarea
          value={edit.text}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={edit.textPlaceholder}
          onChange={(event) => edit.setText(event.target.value)}
          onScroll={syncLineRail}
        />
        {readOnly ? <span className="dial-archive-edit-text__readonly">READ ONLY</span> : null}
      </div>
    </section>
  );
}
