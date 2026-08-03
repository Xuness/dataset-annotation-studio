import type { PreparationWorkbenchContent } from "../../../../pages/spaces/spacePageModel";

interface PreparationTaskRailProps {
  content: PreparationWorkbenchContent;
}

function phase(content: PreparationWorkbenchContent) {
  const operation = content.selectedOperation ?? content.activeOperation;
  if (operation?.status === "recovering") return "RECOVERY";
  if (operation?.status === "running") return "RUNNING";
  if (operation) return "RESULT";
  if (content.preview) return "PREVIEW";
  return "CONFIGURE";
}

export function PreparationTaskRail({ content }: PreparationTaskRailProps) {
  const currentOperation = content.selectedOperation ?? content.activeOperation;
  return (
    <header className="dial-archive-preparation-task-rail">
      <button
        className="dial-archive-preparation-task-rail__back"
        type="button"
        onClick={content.returnToSpace}
      >
        <span>←</span>
        <b>返回整备空间</b>
      </button>
      <div className="dial-archive-preparation-task-rail__identity">
        <i aria-hidden="true" />
        <span>02 / PRP</span>
        <b>{currentOperation?.id ?? "NEW OPERATION"}</b>
      </div>
      <ol className="dial-archive-preparation-task-rail__phases" aria-label="任务阶段">
        {["CONFIGURE", "PREVIEW", "RUNNING", "RESULT", "RECOVERY"].map((item) => (
          <li className={phase(content) === item ? "is-current" : ""} key={item}>
            {item}
          </li>
        ))}
      </ol>
      <div className="dial-archive-preparation-task-rail__history" aria-label="最近整备任务">
        {content.operations.slice(0, 3).map((operation) => (
          <button
            className={content.selectedOperation?.id === operation.id ? "is-current" : ""}
            type="button"
            key={operation.id}
            title={operation.id}
            onClick={() => content.selectOperation(operation.id)}
          >
            <span>{operation.statusLabel}</span>
            <b>{operation.id.slice(0, 8)}</b>
          </button>
        ))}
        <button
          className={!content.selectedOperation ? "is-current is-new" : "is-new"}
          type="button"
          disabled={content.workspaceBusy}
          onClick={() => content.selectOperation(null)}
        >
          <span>DRAFT</span>
          <b>＋ NEW</b>
        </button>
      </div>
    </header>
  );
}
