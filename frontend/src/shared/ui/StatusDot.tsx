import type { AnnotationStatus } from "../api/types";

const LABELS: Record<AnnotationStatus, string> = {
  missing: "未标注",
  valid: "结构闭合",
  invalid: "结构异常",
  empty: "空标注",
  unchecked: "未校验",
  manually_accepted: "人工确认",
};

export function StatusDot({
  status,
  showLabel = false,
}: {
  status: AnnotationStatus;
  showLabel?: boolean;
}) {
  return (
    <span className={`status-dot status-dot--${status}`} title={LABELS[status]}>
      <span aria-hidden="true" />
      {showLabel ? LABELS[status] : null}
    </span>
  );
}
