import type { DeliveryWorkbenchContent } from "../../../../pages/spaces/spacePageModel";
import { DeliveryHistoryRail } from "./DeliveryHistoryRail";
import { DeliveryManifest } from "./DeliveryManifest";
import { formatDeliveryBytes, formatDeliveryDate } from "./model/deliveryPresentation";

interface DeliveryMaterializeStageProps {
  content: DeliveryWorkbenchContent;
}

export function DeliveryMaterializeStage({ content }: DeliveryMaterializeStageProps) {
  const operation = content.selectedOperation;
  if (!operation) return null;
  const alternateActive =
    content.activeOperation && content.activeOperation.id !== operation.id
      ? content.activeOperation
      : null;
  return (
    <section
      className={`dial-archive-delivery-materialize is-${operation.tone}`}
      aria-labelledby="delivery-materialize-title"
    >
      <header className="dial-archive-delivery-materialize__header">
        <span>03 / OUTBOUND OPERATION</span>
        <h1 id="delivery-materialize-title">写入与结果</h1>
        <p>任务使用创建时冻结的 Manifest；当前会话草案不会改变这条操作记录。</p>
      </header>

      <div className="dial-archive-delivery-materialize__body">
        <DeliveryManifest
          compact
          manifest={operation.manifest}
          project={content.project}
          operation={operation}
        />

        <div className="dial-archive-delivery-materialize__route" aria-hidden="true">
          <span />
          <i style={{ width: `${operation.progressPercent}%` }} />
          <b>{operation.statusCode}</b>
        </div>

        <section className="dial-archive-delivery-materialize__terminal" aria-label="交付操作状态">
          <header>
            <span>EXIT GATE // OP.{operation.shortId}</span>
            <b>{operation.statusLabel}</b>
          </header>
          <div className="dial-archive-delivery-materialize__progress">
            <strong>{String(operation.progressPercent).padStart(2, "0")}</strong>
            <span>%</span>
            <i aria-hidden="true">
              <b style={{ height: `${operation.progressPercent}%` }} />
            </i>
          </div>
          <dl>
            <div>
              <dt>OBJECTS //</dt>
              <dd>
                {operation.completedItems} / {operation.totalItems}
              </dd>
            </div>
            <div>
              <dt>VOLUME //</dt>
              <dd>
                {formatDeliveryBytes(operation.copiedBytes)} /{" "}
                {formatDeliveryBytes(operation.totalBytes)}
              </dd>
            </div>
            <div>
              <dt>CREATED //</dt>
              <dd>{formatDeliveryDate(operation.createdAt)}</dd>
            </div>
            <div>
              <dt>WARNINGS //</dt>
              <dd>{operation.warningCount}</dd>
            </div>
          </dl>
          <div className="dial-archive-delivery-materialize__current">
            <span>CURRENT OBJECT //</span>
            <b title={operation.currentRelativePath ?? undefined}>
              {operation.currentRelativePath ??
                (operation.status === "completed" ? "写入已经完成" : "等待下一项")}
            </b>
          </div>
          <div className="dial-archive-delivery-materialize__destination">
            <span>DESTINATION //</span>
            <b title={operation.destinationPath}>{operation.destinationPath}</b>
          </div>
          {operation.errorMessage ? <p>{operation.errorMessage}</p> : null}
          <div className="dial-archive-delivery-materialize__actions">
            <button
              type="button"
              disabled={!operation.canOpenFolder || content.exportPending}
              onClick={() => void content.openFolder(operation.destinationPath)}
            >
              打开结果
            </button>
            {operation.canStop ? (
              <button
                type="button"
                disabled={content.exportPending}
                onClick={() => void content.stopOperation(operation.id)}
              >
                停止任务
              </button>
            ) : null}
            {operation.canResume ? (
              <button
                className="is-primary"
                type="button"
                disabled={content.exportPending}
                onClick={() => void content.resumeOperation(operation.id)}
              >
                继续任务
              </button>
            ) : null}
            {!operation.canStop && !operation.canResume ? (
              <button
                className="is-primary"
                type="button"
                onClick={
                  alternateActive
                    ? () => content.selectOperation(alternateActive.id)
                    : content.returnToSpec
                }
              >
                {alternateActive ? "返回当前写入" : "按当前项目新建方案"}
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <DeliveryHistoryRail
        compact
        operations={content.operations}
        selectedOperationId={operation.id}
        onSelect={content.selectOperation}
        onCreate={content.returnToSpec}
      />
    </section>
  );
}
