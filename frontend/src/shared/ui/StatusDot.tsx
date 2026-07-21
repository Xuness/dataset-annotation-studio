import type { AnnotationStatus } from "../api/types";

type DisplayStatus = AnnotationStatus | "failed";

const LABELS: Record<DisplayStatus, string> = {
  missing: "未标注",
  valid: "结构闭合",
  invalid: "结构异常",
  encoding_error: "编码异常",
  empty: "空标注",
  unchecked: "未校验",
  manually_accepted: "人工确认",
  failed: "生成失败",
};

export function StatusDot({
  status,
  showLabel = false,
  title,
}: {
  status: DisplayStatus;
  showLabel?: boolean;
  title?: string;
}) {
  return (
    <span className={`status-dot status-dot--${status}`} title={title ?? LABELS[status]}>
      <span aria-hidden="true" />
      {showLabel ? LABELS[status] : null}
    </span>
  );
}
