import { useCallback, useEffect, useRef, useState } from "react";

import {
  deferFrontendFirstUseForSession,
  rememberFrontendFirstUseChoice,
  shouldShowFrontendFirstUseDialog,
  type FrontendFirstUseChoice,
} from "./frontendFirstUseState";

export function FrontendFirstUseDialog() {
  const [visible, setVisible] = useState(shouldShowFrontendFirstUseDialog);
  const dialogRef = useRef<HTMLElement>(null);
  const recommendedActionRef = useRef<HTMLAnchorElement>(null);

  const defer = useCallback(() => {
    deferFrontendFirstUseForSession();
    setVisible(false);
  }, []);

  const acknowledge = useCallback((choice: FrontendFirstUseChoice) => {
    rememberFrontendFirstUseChoice(choice);
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    recommendedActionRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        defer();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [defer, visible]);

  if (!visible) return null;

  return (
    <div className="frontend-first-use" data-frontend-first-use>
      <section
        className="frontend-first-use__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frontend-first-use-title"
        aria-describedby="frontend-first-use-description"
        ref={dialogRef}
      >
        <aside className="frontend-first-use__identity" aria-hidden="true">
          <span>NEW THEME ORIENTATION</span>
          <strong>V2</strong>
          <div>
            <b>
              DATASET
              <br />
              ANNOTATION
              <br />
              STUDIO
            </b>
            <small>INTERFACE ROUTE // 00</small>
          </div>
        </aside>

        <div className="frontend-first-use__content">
          <header>
            <span>FIRST VISIT // 操作方式确认</span>
            <h1 id="frontend-first-use-title">第一次使用新版主题吗？</h1>
            <p id="frontend-first-use-description">
              建议先熟悉旧版主题的操作方式。新版沿用相同的项目数据与生产能力，只重新组织了入口、层级和工作台。
            </p>
          </header>

          <div className="frontend-first-use__choices">
            <a
              className="is-recommended"
              href="/legacy.html"
              onClick={() => acknowledge("legacy")}
              ref={recommendedActionRef}
            >
              <span>01 // RECOMMENDED</span>
              <b>先去旧版熟悉</b>
              <small>从熟悉的流程开始，之后可在外观设置中随时返回新版。</small>
              <em>OPEN CLASSIC →</em>
            </a>
            <button type="button" onClick={() => acknowledge("continue")}>
              <span>02 // CONTINUE</span>
              <b>直接使用新版</b>
              <small>我已经了解基本操作，继续进入当前新版工作台。</small>
              <em>ENTER V2 →</em>
            </button>
          </div>

          <button className="frontend-first-use__defer" type="button" onClick={defer}>
            <span>暂时还不确定</span>
            <b>这次先关闭，稍后再提醒</b>
          </button>
        </div>
      </section>
    </div>
  );
}
