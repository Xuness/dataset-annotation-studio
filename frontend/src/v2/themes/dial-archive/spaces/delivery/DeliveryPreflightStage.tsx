import type {
  DeliveryWorkbenchContent,
  QualityFilterId,
} from "../../../../pages/spaces/spacePageModel";
import { formatDeliveryBytes } from "./model/deliveryPresentation";

interface DeliveryPreflightStageProps {
  content: DeliveryWorkbenchContent;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  usable: "当前可用",
  reviewed: "已复核",
  unreviewed: "未复核",
  stale: "来源过期",
  missing: "通道缺失",
  empty: "内容为空",
  invalid: "结构异常",
  encoding_error: "编码异常",
};

export function DeliveryPreflightStage({ content }: DeliveryPreflightStageProps) {
  const preview = content.preview;
  if (!preview) return null;
  const statusRoutes: readonly {
    id: string;
    label: string;
    count: number;
    filter?: QualityFilterId;
  }[] = [
    { id: "usable", label: "可用", count: preview.usableCount },
    { id: "reviewed", label: "已复核", count: preview.reviewedCount },
    { id: "unreviewed", label: "未复核", count: preview.unreviewedCount, filter: "unreviewed" },
    { id: "stale", label: "过期", count: preview.staleCount, filter: "stale" },
    { id: "missing", label: "缺失", count: preview.missingCount, filter: "missing" },
    { id: "invalid", label: "异常", count: preview.invalidCount, filter: "invalid" },
  ];

  return (
    <section className="dial-archive-delivery-preflight" aria-labelledby="delivery-preflight-title">
      <header className="dial-archive-delivery-preflight__header">
        <span>02 / FROZEN MANIFEST</span>
        <h1 id="delivery-preflight-title">冻结与预检</h1>
        <p>当前结果对应这一版方案。修改范围、通道或目的地后需要重新预检。</p>
        <div>
          <span>
            <em>OBJECTS //</em>
            <b>{preview.totalItems}</b>
          </span>
          <span>
            <em>OUTPUT //</em>
            <b>{formatDeliveryBytes(preview.imageBytes + preview.annotationBytes)}</b>
          </span>
          <span
            className={
              preview.blockingIssueCount
                ? "is-danger"
                : preview.warningCount
                  ? "is-warning"
                  : "is-clear"
            }
          >
            <em>STATE //</em>
            <b>
              {preview.blockingIssueCount
                ? "BLOCKED"
                : preview.warningCount
                  ? "ATTENTION"
                  : "CLEAR"}
            </b>
          </span>
        </div>
      </header>

      <aside className="dial-archive-delivery-preflight__status" aria-label="预检状态摘要">
        <span>QUALITY READOUT // 04</span>
        {statusRoutes.map((status) => (
          <button
            type="button"
            disabled={!status.filter}
            onClick={() => status.filter && content.openQuality(status.filter)}
            key={status.id}
          >
            <span>{status.id.toUpperCase()}</span>
            <b>{String(status.count).padStart(2, "0")}</b>
            <em>{status.label}</em>
          </button>
        ))}
        <p>复核是可选核查。黄色状态可以在确认后继续；阻塞项需要先修正方案或目的地。</p>
      </aside>

      <div className="dial-archive-delivery-preflight__manifest">
        <div className="dial-archive-delivery-preflight__token">
          <span>FREEZE TOKEN //</span>
          <b>{preview.token.slice(0, 16).toUpperCase()}</b>
          <i />
        </div>

        {preview.blockingIssues.length ? (
          <div className="dial-archive-delivery-preflight__blockers">
            <span>BLOCKING REGISTER //</span>
            {preview.blockingIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        ) : null}

        <div
          className="dial-archive-delivery-preflight__items"
          role="region"
          aria-label="预检输出清单"
        >
          {preview.items.map((item, index) => {
            const issue = item.blockingIssue ?? item.warningMessage;
            return (
              <article
                className={
                  item.blockingIssue ? "is-blocked" : item.warningCode ? "is-warning" : "is-clear"
                }
                key={item.assetId}
              >
                <span>{String(index + 1).padStart(3, "0")}</span>
                <span>
                  <b title={item.sourceRelativePath}>{item.sourceRelativePath}</b>
                  <small title={item.targetOutputs.join("\n")}>
                    {item.targetOutputs.length} OUTPUTS · {item.targetImageName}
                  </small>
                </span>
                <span>
                  <b>{STATUS_LABELS[item.annotationStatus] ?? item.annotationStatus}</b>
                  <small>
                    {Object.values(item.channelStatuses)
                      .map((status) => STATUS_LABELS[status] ?? status)
                      .join(" / ") || "NO CHANNEL"}
                  </small>
                </span>
                <span>
                  <b>{formatDeliveryBytes(item.imageBytes + item.annotationBytes)}</b>
                  <small>{issue ?? "READY"}</small>
                </span>
              </article>
            );
          })}
          {preview.truncated ? (
            <p className="dial-archive-delivery-preflight__truncated">
              当前展示 {preview.items.length} / {preview.totalItems} 项；预检已经覆盖完整范围。
            </p>
          ) : null}
        </div>
      </div>

      <footer className="dial-archive-delivery-preflight__actions">
        <button type="button" onClick={content.returnToSpec}>
          ← 返回方案编组
        </button>
        <div>
          <span>
            {preview.blockingIssueCount
              ? `${preview.blockingIssueCount} 个阻塞项`
              : preview.warningCount
                ? `${preview.warningCount} 个警告将在开始时确认`
                : "当前清单可以直接写出"}
          </span>
          <button
            type="button"
            disabled={!content.canExport || content.exportPending}
            onClick={() => void content.startExport()}
          >
            <b>
              {content.exportPending
                ? "正在创建任务"
                : preview.warningCount
                  ? "确认并开始交付"
                  : "开始交付"}
            </b>
            <em>MATERIALIZE →</em>
          </button>
        </div>
      </footer>
    </section>
  );
}
