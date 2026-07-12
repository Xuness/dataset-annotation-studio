import { Bot, Images, ListChecks, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";

const items = [
  { id: "assets", icon: Images, label: "素材" },
  { id: "preprocess", icon: SlidersHorizontal, label: "预处理" },
  { id: "jobs", icon: Bot, label: "标注任务" },
  { id: "review", icon: ListChecks, label: "审核" },
];

export function NavigationRail({
  projectId,
  active = "assets",
}: {
  projectId: string;
  active?: string;
}) {
  const navigate = useNavigate();

  function open(id: string) {
    if (id === "assets") navigate(`/workspace/${projectId}`);
    if (id === "review") navigate(`/workspace/${projectId}/review`);
    if (id === "jobs") navigate(`/workspace/${projectId}/jobs`);
    if (id === "preprocess") navigate(`/workspace/${projectId}/preprocess`);
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
