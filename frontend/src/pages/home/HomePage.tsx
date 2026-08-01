import { useState } from "react";
import { ArrowRight, Cable, RefreshCw, Settings, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  useOpenWorkspace,
  useRecentWorkspaces,
  useRemoveRecentWorkspace,
} from "../../features/workspaces/hooks";
import { useHasUnreadUpdateAnnouncement } from "../../features/updateAnnouncements/readState";
import { UpdateAnnouncementIndicator } from "../../legacy/components/UpdateAnnouncementIndicator";
import { pickWorkspaceFolder } from "../../shared/desktop/pickFolder";
import { useSettingsCenter } from "../../shared/settings/settingsCenterStore";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { useAppPreferences } from "../../shared/theme/appPreferences";
import { getThemeDefinition } from "../../shared/theme/themes";
import { alertDialog, confirmDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import "./home.css";

const projectDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatProjectDate(value: string | null): string {
  if (!value) return "尚未打开";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "最近打开" : projectDateFormatter.format(date);
}

export function HomePage() {
  const navigate = useNavigate();
  const recent = useRecentWorkspaces();
  const openMutation = useOpenWorkspace();
  const removeRecentMutation = useRemoveRecentWorkspace();
  const openSettings = useSettingsCenter((state) => state.open);
  const hasUnreadUpdateAnnouncement = useHasUnreadUpdateAnnouncement();
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const themeId = useAppPreferences((state) => state.preferences.themeId);
  const homeContent = useAppPreferences((state) => state.preferences.homeContent);
  const theme = getThemeDefinition(themeId);
  const hasHomeHeadline = Boolean(homeContent.headline);
  const hasHomeDescription = Boolean(homeContent.description);
  const hasHomeCopy = hasHomeHeadline || hasHomeDescription;
  const [message, setMessage] = useState<string | null>(null);

  async function chooseAndOpenWorkspace() {
    setMessage(null);
    try {
      const path = await pickWorkspaceFolder();
      if (!path) return;
      const result = await openMutation.mutateAsync(path);
      if (result.scan.failed) {
        const examples = result.scan.issues
          .slice(0, 5)
          .map((issue) => `${issue.path}：${issue.message}`)
          .join("\n");
        await alertDialog(
          `工作区已打开，但跳过了 ${result.scan.failed} 个损坏或无法读取的图片。\n${examples}`,
          { title: "部分图片被跳过" },
        );
      }
      setActiveProject(result.workspace.project_id);
      navigate(`/workspace/${result.workspace.project_id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开工作区。 ");
    }
  }

  function enterWorkspace(projectId: string, exists: boolean) {
    if (!exists) {
      void chooseAndOpenWorkspace();
      return;
    }
    setActiveProject(projectId);
    navigate(`/workspace/${projectId}`);
  }

  async function removeFromRecent(projectId: string, name: string) {
    const confirmed = await confirmDialog(
      `只会将“${name}”从最近项目列表中移除。\n\n` +
        "不会删除数据集、标注、缓存或 .annotation-workspace；" +
        "以后重新打开该文件夹，它会再次出现在最近项目中。",
      {
        title: "从最近项目移除",
        confirmLabel: "移除",
        cancelLabel: "取消",
      },
    );
    if (!confirmed) return;
    setMessage(null);
    try {
      await removeRecentMutation.mutateAsync(projectId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法从最近项目中移除。");
    }
  }

  return (
    <main className="home-page">
      <div className="home-gallery-scene" aria-hidden="true" />

      <header className="home-topbar" data-surface-region="home-topbar">
        <strong className="home-brand">Dataset Studio</strong>
        <nav className="home-navigation" aria-label="首页导航">
          <button type="button" onClick={() => navigate("/presets")}>
            <Cable size={14} aria-hidden="true" />
            <span>预设与连接</span>
          </button>
          <button
            type="button"
            aria-label={hasUnreadUpdateAnnouncement ? "设置，有未读更新公告" : undefined}
            onClick={() => openSettings("appearance")}
          >
            <Settings size={14} aria-hidden="true" />
            <span>设置</span>
            {hasUnreadUpdateAnnouncement ? <UpdateAnnouncementIndicator /> : null}
          </button>
        </nav>
      </header>

      <div className="home-shell">
        <section
          className="home-hero"
          aria-labelledby={hasHomeHeadline ? "home-title" : undefined}
          aria-label={hasHomeHeadline ? undefined : "数据集入口"}
        >
          <div className="home-hero__copy">
            <p className="home-hero__kicker">
              <span aria-hidden="true" />
              {theme.englishName} · Local archive
            </p>
            {hasHomeCopy ? (
              <div className="home-hero__text">
                {hasHomeHeadline ? <h1 id="home-title">{homeContent.headline}</h1> : null}
                {hasHomeDescription ? (
                  <p className="home-hero__description">{homeContent.description}</p>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="home-entry"
              data-surface-region="home-entry"
              onClick={() => void chooseAndOpenWorkspace()}
              disabled={openMutation.isPending}
            >
              <span>{openMutation.isPending ? "正在打开" : "打开数据集"}</span>
              {openMutation.isPending ? <Spinner /> : <ArrowRight size={17} aria-hidden="true" />}
            </button>
            {message ? <p className="home-error">{message}</p> : null}
          </div>
        </section>

        <section className="recent-section" aria-labelledby="recent-title">
          <div className="section-heading">
            <h2 id="recent-title">最近项目</h2>
            <span className="section-heading__line" aria-hidden="true" />
            <button type="button" onClick={() => void recent.refetch()} title="刷新最近项目">
              <RefreshCw size={14} aria-hidden="true" />
              <span>刷新</span>
            </button>
          </div>

          {recent.isLoading ? (
            <div className="recent-placeholder" data-surface-region="home-recents">
              <Spinner label="读取最近项目" />
            </div>
          ) : recent.isError ? (
            <div
              className="recent-placeholder recent-placeholder--error"
              data-surface-region="home-recents"
            >
              <p>后端服务尚未准备好。</p>
              <button type="button" onClick={() => void recent.refetch()}>
                重新连接
              </button>
            </div>
          ) : recent.data?.length ? (
            <div className="recent-grid">
              {recent.data.slice(0, 3).map((workspace) => (
                <article className="recent-card-shell" key={workspace.project_id}>
                  <button
                    type="button"
                    className={`recent-card ${workspace.exists ? "" : "recent-card--missing"}`}
                    data-surface-region="home-recents"
                    title={workspace.root_path}
                    onClick={() => enterWorkspace(workspace.project_id, workspace.exists)}
                  >
                    <span className="recent-card__marker" aria-hidden="true" />
                    <span className="recent-card__body">
                      <strong>{workspace.name}</strong>
                      <small>{workspace.root_path}</small>
                      <span className="recent-card__meta">
                        {workspace.exists ? (
                          <>
                            <span>图像 {workspace.asset_count.toLocaleString("zh-CN")}</span>
                            <span>已标注 {workspace.annotated_count.toLocaleString("zh-CN")}</span>
                            <time dateTime={workspace.last_opened_at ?? undefined}>
                              {formatProjectDate(workspace.last_opened_at)}
                            </time>
                          </>
                        ) : (
                          <span>文件夹已移动，点击重新定位</span>
                        )}
                      </span>
                    </span>
                    <ArrowRight className="recent-card__arrow" size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="recent-card__remove"
                    data-surface-region="home-recents"
                    aria-label={`从最近项目移除 ${workspace.name}`}
                    title="从最近项目移除（不会删除文件）"
                    disabled={
                      removeRecentMutation.isPending &&
                      removeRecentMutation.variables === workspace.project_id
                    }
                    onClick={() => void removeFromRecent(workspace.project_id, workspace.name)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="recent-placeholder" data-surface-region="home-recents">
              <p>档案尚空。打开一个图片文件夹，让第一组数据在这里显影。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
