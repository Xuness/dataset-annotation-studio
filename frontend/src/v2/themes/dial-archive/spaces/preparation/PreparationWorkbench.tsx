import type { PreparationWorkbenchContent } from "../../../../pages/spaces/spacePageModel";
import { PreparationCanvas } from "./PreparationCanvas";
import { PreparationTaskRail } from "./PreparationTaskRail";

interface PreparationWorkbenchProps {
  content: PreparationWorkbenchContent;
}

export function PreparationWorkbench({ content }: PreparationWorkbenchProps) {
  if (content.status === "no-context") {
    return (
      <section className="dial-archive-preparation-workbench-state is-no-context">
        <div aria-hidden="true">// NO SOURCE</div>
        <span>CONTEXT REQUIRED // SPACE 02</span>
        <h1>任务画布等待项目源</h1>
        <p>先在项目档案中装载一个本地工作目录，再建立整备任务。</p>
        <div>
          <button type="button" onClick={content.openArchive}>
            <b>进入项目档案</b>
            <em>OPEN ARCHIVE →</em>
          </button>
          <button type="button" onClick={content.returnToSpace}>
            返回整备空间
          </button>
        </div>
      </section>
    );
  }

  if (content.status === "loading") {
    return (
      <section className="dial-archive-preparation-workbench-state is-loading" role="status">
        <div aria-hidden="true">02</div>
        <span>LOADING PROJECT EVIDENCE</span>
        <h1>正在建立整备任务场</h1>
        <i aria-hidden="true" />
      </section>
    );
  }

  if (content.status === "error") {
    return (
      <section className="dial-archive-preparation-workbench-state is-error" role="alert">
        <div aria-hidden="true">// ATTENTION</div>
        <span>WORKBENCH CONTEXT FAILURE</span>
        <h1>任务画布无法装载</h1>
        <p>{content.error ?? "当前项目上下文不可用。"}</p>
        <div>
          <button type="button" onClick={content.openArchive}>
            返回项目档案
          </button>
          <button type="button" onClick={content.returnToSpace}>
            返回整备空间
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dial-archive-preparation-workbench" aria-label="数据整备任务画布">
      <PreparationTaskRail content={content} />
      <PreparationCanvas content={content} />
      {content.error ? (
        <div className="dial-archive-preparation-workbench__error" role="alert">
          <span>OPERATION ATTENTION //</span>
          <p>{content.error}</p>
        </div>
      ) : null}
      {content.confirmation ? (
        <div className="dial-archive-preparation-confirmation" role="presentation">
          <div
            className={`dial-archive-preparation-confirmation__panel is-${content.confirmation.tone}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preparation-confirmation-title"
          >
            <span>VERIFY OPERATION //</span>
            <h2 id="preparation-confirmation-title">{content.confirmation.title}</h2>
            <p>{content.confirmation.message}</p>
            <div>
              <button type="button" onClick={() => content.resolveConfirmation(false)}>
                {content.confirmation.cancelLabel}
              </button>
              <button type="button" autoFocus onClick={() => content.resolveConfirmation(true)}>
                {content.confirmation.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
