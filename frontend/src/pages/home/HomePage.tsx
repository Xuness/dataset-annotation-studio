import { useState } from "react";
import { ArrowRight, FolderHeart, FolderOpen, RefreshCw, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useOpenWorkspace, useRecentWorkspaces } from "../../features/workspaces/hooks";
import { pickWorkspaceFolder } from "../../shared/desktop/pickFolder";
import { useAppStore } from "../../shared/store/appStore";
import { Button } from "../../shared/ui/Button";
import { alertDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import "./home.css";
import "./home-illustration.css";

export function HomePage() {
  const navigate = useNavigate();
  const recent = useRecentWorkspaces();
  const openMutation = useOpenWorkspace();
  const setActiveProject = useAppStore((state) => state.setActiveProject);
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

  return (
    <main className="home-page">
      <header className="home-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>Dataset Studio</strong>
            <small>图像数据集标注工作台</small>
          </div>
        </div>
        <Button icon={<Settings2 size={16} />} onClick={() => navigate("/presets")}>
          预设与连接
        </Button>
      </header>

      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">A quiet place for careful work</p>
          <h1>
            让每一组图像，
            <br />
            在安静中变得清晰。
          </h1>
          <p className="home-hero__description">
            文件夹就是项目。标注、历史和恢复记录都随它一起保留，
            不需要将数据交给另一个陌生的素材库。
          </p>
          <Button
            tone="primary"
            icon={openMutation.isPending ? <Spinner /> : <FolderOpen size={17} />}
            onClick={() => void chooseAndOpenWorkspace()}
            disabled={openMutation.isPending}
          >
            打开文件夹项目
          </Button>
          {message ? <p className="inline-error">{message}</p> : null}
        </div>
        <div className="still-life" aria-hidden="true">
          <div className="still-life__sun" />
          <div className="still-life__horizon" />
          <div className="still-life__paper still-life__paper--back" />
          <div className="still-life__paper still-life__paper--front">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Recent folders</span>
            <h2>最近的项目</h2>
          </div>
          <button className="icon-button" onClick={() => void recent.refetch()} title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>

        {recent.isLoading ? (
          <div className="recent-placeholder">
            <Spinner label="读取最近项目" />
          </div>
        ) : recent.isError ? (
          <div className="recent-placeholder recent-placeholder--error">
            <p>后端服务尚未准备好。</p>
            <Button onClick={() => void recent.refetch()}>重新连接</Button>
          </div>
        ) : recent.data?.length ? (
          <div className="recent-grid">
            {recent.data.map((workspace) => (
              <button
                className={`recent-card ${workspace.exists ? "" : "recent-card--missing"}`}
                key={workspace.project_id}
                onClick={() => enterWorkspace(workspace.project_id, workspace.exists)}
              >
                <span className="recent-card__icon">
                  <FolderHeart size={20} />
                </span>
                <span className="recent-card__body">
                  <strong>{workspace.name}</strong>
                  <small>{workspace.root_path}</small>
                  <span>
                    {workspace.exists
                      ? `${workspace.asset_count} 张图片 · ${workspace.annotated_count} 已标注`
                      : "文件夹已移动，点击重新定位"}
                  </span>
                </span>
                <ArrowRight className="recent-card__arrow" size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-placeholder">
            <p>还没有打开过项目。选择一个已经整理好的图片文件夹开始吧。</p>
          </div>
        )}
      </section>
    </main>
  );
}
