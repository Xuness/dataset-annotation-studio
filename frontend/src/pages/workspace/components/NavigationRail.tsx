import { Bot, FolderOutput, Images, ListChecks, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useUnsavedChangesGuard } from "../../../shared/desktop/useUnsavedChanges";

const items = [
  { id: "assets", icon: Images, label: "素材" },
  { id: "preprocess", icon: SlidersHorizontal, label: "预处理" },
  { id: "jobs", icon: Bot, label: "任务" },
  { id: "review", icon: ListChecks, label: "审核" },
  { id: "export", icon: FolderOutput, label: "导出" },
];

export function NavigationRail({
  projectId,
  active = "assets",
}: {
  projectId: string;
  active?: string;
}) {
  const navigate = useNavigate();
  const { confirmDiscard } = useUnsavedChangesGuard();

  function open(id: string) {
    if (id === active) return;
    void (async () => {
      if (!(await confirmDiscard())) return;
      if (id === "assets") navigate(`/workspace/${projectId}`);
      if (id === "review") navigate(`/workspace/${projectId}/review`);
      if (id === "jobs") navigate(`/workspace/${projectId}/jobs`);
      if (id === "preprocess") navigate(`/workspace/${projectId}/preprocess`);
      if (id === "export") navigate(`/workspace/${projectId}/export`);
    })();
  }

  return (
    <nav className="navigation-rail" aria-label="工作区功能">
      {items.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={active === id ? "is-active" : ""}
          title={label}
          onClick={() => open(id)}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
