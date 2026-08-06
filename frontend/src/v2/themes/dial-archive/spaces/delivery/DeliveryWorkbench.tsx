import type { DeliveryWorkbenchContent as DeliveryWorkbenchContentModel } from "../../../../pages/spaces/spacePageModel";
import { DeliveryMaterializeStage } from "./DeliveryMaterializeStage";
import { DeliveryPreflightStage } from "./DeliveryPreflightStage";
import { DeliverySpecStage } from "./DeliverySpecStage";

interface DeliveryWorkbenchProps {
  content: DeliveryWorkbenchContentModel;
}

function DeliveryWorkbenchState({ content }: DeliveryWorkbenchProps) {
  const noContext = content.status === "no-context";
  return (
    <section className={`dial-archive-delivery-workbench-state is-${content.status}`}>
      <span>DELIVERY WORKBENCH // 05</span>
      <h1>
        {noContext
          ? "尚未装载项目"
          : content.status === "loading"
            ? "正在装载交付台"
            : "交付台不可用"}
      </h1>
      <p>
        {content.error ?? (noContext ? "先从项目档案装载一个工作区。" : "正在读取草案与交付操作。")}
      </p>
      <div>
        <button type="button" onClick={content.returnToSpace}>
          返回 05 交付空间
        </button>
        {noContext ? (
          <button type="button" onClick={content.openArchive}>
            前往 01 项目档案
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function DeliveryWorkbench({ content }: DeliveryWorkbenchProps) {
  if (content.status !== "ready") return <DeliveryWorkbenchState content={content} />;
  const phases = [
    { id: "spec" as const, number: "01", label: "SPEC", detail: "方案编组" },
    { id: "preflight" as const, number: "02", label: "PREFLIGHT", detail: "冻结与预检" },
    { id: "materialize" as const, number: "03", label: "MATERIALIZE", detail: "写入与结果" },
  ];
  return (
    <section
      className={`dial-archive-delivery-workbench is-${content.phase}`}
      aria-label="发布交付工作台"
    >
      <header className="dial-archive-delivery-workbench__bar">
        <button type="button" onClick={content.returnToSpace}>
          <span>←</span>
          <b>RETURN // SPACE 05</b>
        </button>
        <div className="dial-archive-delivery-workbench__project">
          <span>DELIVERY WORKBENCH</span>
          <b>{content.project?.name}</b>
        </div>
        <nav aria-label="交付阶段">
          {phases.map((phase, index) => {
            const active = content.phase === phase.id;
            const available =
              phase.id === "spec"
                ? !content.activeOperation
                : phase.id === "preflight"
                  ? Boolean(content.preview)
                  : Boolean(content.selectedOperation);
            return (
              <button
                type="button"
                className={active ? "is-active" : undefined}
                aria-current={active ? "step" : undefined}
                disabled={!available || active}
                onClick={phase.id === "spec" ? content.returnToSpec : undefined}
                key={phase.id}
              >
                <span>{phase.number}</span>
                <b>{phase.label}</b>
                <em>{phase.detail}</em>
                {index < phases.length - 1 ? <i aria-hidden="true" /> : null}
              </button>
            );
          })}
        </nav>
        <div className="dial-archive-delivery-workbench__state">
          <span>
            {content.selectedOperation
              ? `OP.${content.selectedOperation.shortId}`
              : "SESSION.DRAFT"}
          </span>
          <b>{content.selectedOperation?.statusCode ?? content.phase.toUpperCase()}</b>
        </div>
      </header>

      <div className="dial-archive-delivery-workbench__viewport">
        {content.phase === "spec" ? <DeliverySpecStage content={content} /> : null}
        {content.phase === "preflight" ? <DeliveryPreflightStage content={content} /> : null}
        {content.phase === "materialize" ? <DeliveryMaterializeStage content={content} /> : null}
      </div>

      {content.dialog ? (
        <div className="dial-archive-delivery-dialog" role="presentation">
          <section
            className={`dial-archive-delivery-dialog__panel is-${content.dialog.tone}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-dialog-title"
          >
            <span>{content.dialog.kind === "alert" ? "NOTICE" : "CONFIRMATION"} // DLV</span>
            <h2 id="delivery-dialog-title">{content.dialog.title}</h2>
            <p>{content.dialog.message}</p>
            <div>
              {content.dialog.cancelLabel ? (
                <button type="button" onClick={() => content.resolveDialog(false)}>
                  {content.dialog.cancelLabel}
                </button>
              ) : null}
              <button type="button" autoFocus onClick={() => content.resolveDialog(true)}>
                {content.dialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
