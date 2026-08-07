import { useEffect, useState } from "react";

import type {
  ArchiveProjectRecord,
  ArchiveSpaceContent,
} from "../../../../pages/spaces/spacePageModel";
import { presentArchiveProject } from "../model/projectPresentation";

interface ArchiveProjectDetailProps {
  project: ArchiveProjectRecord;
  content: ArchiveSpaceContent;
  open: boolean;
  motionVersion: number;
  onClose(): void;
}

export function ArchiveProjectDetail({
  project,
  content,
  open,
  motionVersion,
  onClose,
}: ArchiveProjectDetailProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const presentation = presentArchiveProject(project, content.activeProjectId);
  const active = project.id === content.activeProjectId;
  const removing = project.id === content.removingProjectId;

  useEffect(() => setConfirmingRemoval(false), [project.id]);

  const removeProject = async () => {
    if (!confirmingRemoval) {
      setConfirmingRemoval(true);
      return;
    }
    await content.removeProject(project.id);
    onClose();
  };

  return (
    <div
      className={`dial-archive-project-detail-wrap${open ? " is-open" : ""}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="dial-archive-project-detail-clip">
        <section className="dial-archive-project-detail" aria-live="polite">
          <header className="dial-archive-project-detail__chrome">
            <span>PROJECT INFORMATION // ARC</span>
            <button type="button" onClick={onClose}>
              ✕ CLOSE
            </button>
          </header>
          <div
            className="dial-archive-project-detail__grid"
            key={`detail-${project.id}-${motionVersion}`}
          >
            <div className="dial-archive-project-detail__identity">
              <div className="dial-archive-project-detail__head">
                <span>PROJECT // INFORMATION</span>
                <b>{project.id}</b>
              </div>
              <h3>{project.name}</h3>
              <p>{project.rootPath}</p>
            </div>
            <div className="dial-archive-project-detail__data">
              <div className="dial-archive-project-detail__kicker">
                LOCAL WORKSPACE / CURRENT RECORD
              </div>
              <dl className="dial-archive-project-detail__fields">
                <div>
                  <dt>素材 ASSETS</dt>
                  <dd>{presentation.assetCount} ITEMS</dd>
                </div>
                <div>
                  <dt>已标注 ANNOTATED</dt>
                  <dd>{presentation.annotatedCount} ITEMS</dd>
                </div>
                <div>
                  <dt>异常 INVALID</dt>
                  <dd>{presentation.invalidCount} ITEMS</dd>
                </div>
                <div>
                  <dt>状态 STATE</dt>
                  <dd>{presentation.state}</dd>
                </div>
                <div>
                  <dt>更新 UPDATED</dt>
                  <dd>{presentation.updatedAt}</dd>
                </div>
                <div>
                  <dt>上下文 CONTEXT</dt>
                  <dd>{active ? "CURRENT PROJECT" : "AVAILABLE"}</dd>
                </div>
              </dl>
              <div className="dial-archive-project-detail__actions">
                <button
                  type="button"
                  disabled={!project.exists}
                  title={project.exists ? undefined : "项目目录当前不可用"}
                  onClick={() => content.openProjectWorkbench(project.id)}
                >
                  <b>进入项目工作间</b>
                  <em>{project.exists ? "OPEN" : "OFFLINE"}</em>
                </button>
                <button
                  className={active ? "is-loaded" : undefined}
                  type="button"
                  disabled={active}
                  onClick={() => content.loadProject(project.id)}
                >
                  <b>{active ? "已装载为当前项目" : "装载为当前项目"}</b>
                  <em>{active ? "CURRENT" : "LOAD"}</em>
                </button>
              </div>
              <div className="dial-archive-project-detail__links">
                <button type="button" onClick={() => void content.revealProject(project.id)}>
                  在文件管理器中打开 REVEAL →
                </button>
              </div>
              <div className="dial-archive-project-detail__danger">
                <button type="button" disabled={removing} onClick={() => void removeProject()}>
                  {removing
                    ? "正在移除登记"
                    : confirmingRemoval
                      ? "确认移除项目登记"
                      : "移除项目登记 REMOVE"}
                </button>
                <span>DANGER // 仅移除登记，不删除磁盘文件</span>
              </div>
            </div>
          </div>
          <footer className="dial-archive-project-detail__foot">
            <span>{project.id} // PAGE 01/01</span>
            <span>PROJECT PAGE 01/01</span>
          </footer>
        </section>
      </div>
    </div>
  );
}
