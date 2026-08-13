import {
  Bot,
  FolderOutput,
  Images,
  ListFilter,
  ListChecks,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useHasUnreadUpdateAnnouncement } from "../../../src/features/updateAnnouncements/readState";
import { UpdateAnnouncementIndicator } from "../../legacy/components/UpdateAnnouncementIndicator";
import { useLegacyUnsavedChangesGuard } from "../../legacy/hooks/useLegacyUnsavedChangesGuard";
import { useSettingsCenter } from "../../shared/settings/settingsCenterStore";

export type WorkspaceSection = "assets" | "screening" | "preprocess" | "jobs" | "review" | "export";

interface NavigationItem {
  id: WorkspaceSection;
  icon: LucideIcon;
  label: string;
}

const items: readonly NavigationItem[] = [
  { id: "assets", icon: Images, label: "素材" },
  { id: "screening", icon: ListFilter, label: "筛选" },
  { id: "preprocess", icon: SlidersHorizontal, label: "预处理" },
  { id: "jobs", icon: Bot, label: "任务" },
  { id: "review", icon: ListChecks, label: "审核" },
  { id: "export", icon: FolderOutput, label: "导出" },
];

const sectionPath: Record<WorkspaceSection, (projectId: string) => string> = {
  assets: (projectId) => `/workspace/${projectId}`,
  screening: (projectId) => `/workspace/${projectId}/screening`,
  preprocess: (projectId) => `/workspace/${projectId}/preprocess`,
  jobs: (projectId) => `/workspace/${projectId}/jobs`,
  review: (projectId) => `/workspace/${projectId}/review`,
  export: (projectId) => `/workspace/${projectId}/export`,
};

export function NavigationRail({
  projectId,
  active = "assets",
}: {
  projectId: string;
  active?: WorkspaceSection;
}) {
  const navigate = useNavigate();
  const { confirmDiscard } = useLegacyUnsavedChangesGuard();
  const openSettings = useSettingsCenter((state) => state.open);
  const hasUnreadUpdateAnnouncement = useHasUnreadUpdateAnnouncement();

  function open(id: WorkspaceSection) {
    if (id === active) return;
    void (async () => {
      if (!(await confirmDiscard())) return;
      navigate(sectionPath[id](projectId));
    })();
  }

  return (
    <nav className="navigation-rail" data-surface-region="navigation" aria-label="工作区功能">
      <div className="navigation-rail__destinations">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            type="button"
            key={id}
            className={active === id ? "is-active" : ""}
            title={label}
            aria-current={active === id ? "page" : undefined}
            onClick={() => open(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="navigation-rail__utility">
        <button
          type="button"
          title={hasUnreadUpdateAnnouncement ? "设置 · 有未读更新公告" : "设置"}
          aria-label={hasUnreadUpdateAnnouncement ? "设置，有未读更新公告" : undefined}
          onClick={() => openSettings("appearance")}
        >
          <Settings size={18} aria-hidden="true" />
          <span>设置</span>
          {hasUnreadUpdateAnnouncement ? <UpdateAnnouncementIndicator /> : null}
        </button>
      </div>
    </nav>
  );
}
