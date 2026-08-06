import type { DeliverySpaceContent } from "../../../../pages/spaces/spacePageModel";
import { formatDeliveryBytes, formatDeliveryDate } from "./model/deliveryPresentation";

interface DeliveryExitGateProps {
  content: DeliverySpaceContent;
}

function actionLabel(content: DeliverySpaceContent): {
  title: string;
  code: string;
  detail: string;
} {
  const operation = content.focusOperation;
  if (!operation) {
    return {
      title: content.manifest.draft ? "继续编辑方案" : "建立交付方案",
      code: content.manifest.draft ? "CONTINUE SPEC" : "CREATE SPEC",
      detail: content.manifest.draft ? "当前会话草案等待预检" : "编组范围、通道与输出方式",
    };
  }
  if (operation.status === "completed") {
    return { title: "打开交付结果", code: "OPEN RESULT", detail: operation.destinationPath };
  }
  if (operation.canResume) {
    return { title: "恢复交付", code: "RESUME", detail: "进入交付台确认并继续任务" };
  }
  if (operation.status === "failed") {
    return {
      title: "查看失败记录",
      code: "INSPECT",
      detail: operation.errorMessage ?? "查看任务快照",
    };
  }
  return {
    title: "查看写入进度",
    code: "TRACK",
    detail: operation.currentRelativePath ?? "任务正在出站",
  };
}

export function DeliveryExitGate({ content }: DeliveryExitGateProps) {
  const operation = content.focusOperation;
  const action = actionLabel(content);
  const activate = () => {
    if (operation?.status === "completed") {
      void content.openFolder(operation.destinationPath);
      return;
    }
    content.openWorkbench(operation?.id);
  };

  return (
    <aside
      className={`dial-archive-delivery-exit-gate is-${operation?.tone ?? "idle"}`}
      aria-label="出站终端"
    >
      <header>
        <span>EXIT GATE // 05</span>
        <b>{operation?.statusCode ?? (content.manifest.draft ? "DRAFT" : "STANDBY")}</b>
      </header>

      <div className="dial-archive-delivery-exit-gate__signal" aria-hidden="true">
        <span />
        <i style={{ width: `${operation?.progressPercent ?? 0}%` }} />
        <b>{String(operation?.progressPercent ?? 0).padStart(2, "0")}</b>
      </div>

      <div className="dial-archive-delivery-exit-gate__state">
        <span>{operation ? `OP.${operation.shortId}` : "SESSION MANIFEST"}</span>
        <h2>{operation?.statusLabel ?? (content.manifest.draft ? "方案草案" : "等待编组")}</h2>
        {operation ? (
          <dl>
            <div>
              <dt>OBJECTS</dt>
              <dd>
                {operation.completedItems} / {operation.totalItems}
              </dd>
            </div>
            <div>
              <dt>VOLUME</dt>
              <dd>
                {formatDeliveryBytes(operation.copiedBytes)} /{" "}
                {formatDeliveryBytes(operation.totalBytes)}
              </dd>
            </div>
            <div>
              <dt>STAMP</dt>
              <dd>{formatDeliveryDate(operation.createdAt)}</dd>
            </div>
          </dl>
        ) : (
          <p>从当前项目建立交付清单，预检会冻结实际素材与标注修订。</p>
        )}
      </div>

      <button className="dial-archive-delivery-exit-gate__primary" type="button" onClick={activate}>
        <span>
          <b>{action.title}</b>
          <small title={action.detail}>{action.detail}</small>
        </span>
        <em>{action.code} →</em>
      </button>
      <button
        className="dial-archive-delivery-exit-gate__secondary"
        type="button"
        onClick={() => content.openQuality("needs_review")}
      >
        查看 04 质量状态
        <span>QAC ↗</span>
      </button>

      {content.message ? (
        <p className="dial-archive-delivery-exit-gate__message">{content.message}</p>
      ) : null}
    </aside>
  );
}
