import { Bot, Languages, UserRoundCheck } from "lucide-react";
import type { JobCenterKind } from "../../../../src/application/jobs/jobCenterState";
export function JobKindSelector({
  kind,
  onChange,
}: {
  kind: JobCenterKind;
  onChange: (kind: JobCenterKind) => void;
}) {
  return (
    <div className="job-kind-switch job-kind-switch--three" aria-label="任务类型">
      {(
        [
          { id: "annotation", label: "标注", icon: Bot },
          { id: "translation", label: "翻译", icon: Languages },
          { id: "character", label: "角色审查", icon: UserRoundCheck },
        ] as const
      ).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          data-testid={`job-kind-${id}`}
          className={kind === id ? "is-active" : ""}
          aria-pressed={kind === id}
          onClick={() => onChange(id)}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
