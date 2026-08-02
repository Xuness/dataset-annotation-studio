import { useCallback, useEffect, useRef, useState } from "react";

import type { ArchiveSpaceContent as ArchiveSpaceContentModel } from "../../../../pages/spaces/spacePageModel";
import { DialArchiveBarcode } from "../../components/DialArchivePrimitives";
import { ArchiveHero } from "./ArchiveHero";
import { ArchiveProjectDetail } from "./ArchiveProjectDetail";
import { ArchiveProjectStage } from "./ArchiveProjectStage";
import { formatProjectSerial, presentArchiveProject } from "../model/projectPresentation";

interface ArchiveSpaceContentProps {
  content: ArchiveSpaceContentModel;
}

interface ProjectMotionState {
  direction: -1 | 0 | 1;
  version: number;
}

export function ArchiveSpaceContent({ content }: ArchiveSpaceContentProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [motion, setMotion] = useState<ProjectMotionState>({ direction: 0, version: 0 });
  const initializedRef = useRef(false);
  const projects = content.projects;

  useEffect(() => {
    if (!projects.length) {
      setFocusedIndex(0);
      setDetailOpen(false);
      initializedRef.current = false;
      return;
    }

    if (pendingFocusId) {
      const pendingIndex = projects.findIndex((project) => project.id === pendingFocusId);
      if (pendingIndex >= 0) {
        setFocusedIndex(pendingIndex);
        setPendingFocusId(null);
        initializedRef.current = true;
        return;
      }
    }

    if (!initializedRef.current) {
      const activeIndex = projects.findIndex((project) => project.id === content.activeProjectId);
      if (activeIndex >= 0) setFocusedIndex(activeIndex);
      initializedRef.current = true;
      return;
    }

    setFocusedIndex((current) => Math.min(current, projects.length - 1));
  }, [content.activeProjectId, pendingFocusId, projects]);

  const moveProject = useCallback(
    (delta: number) => {
      if (projects.length < 2 || delta === 0) return;
      setMotion((state) => ({
        direction: delta < 0 ? -1 : 1,
        version: state.version + 1,
      }));
      setFocusedIndex((current) => (current + delta + projects.length) % projects.length);
    },
    [projects.length],
  );

  const registerProject = async () => {
    const projectId = await content.registerProject();
    if (projectId) setPendingFocusId(projectId);
  };

  const focusedProject = projects[focusedIndex];
  const focusedPresentation = focusedProject
    ? presentArchiveProject(focusedProject, content.activeProjectId)
    : null;

  return (
    <article className="dial-archive-archive-page" aria-label="项目档案空间">
      <ArchiveHero content={content} onRegisterProject={() => void registerProject()} />
      <section className="dial-archive-registry" id="project-registry">
        <div className="dial-archive-space-frame">
          <header className="dial-archive-registry__head">
            <div>
              <span>ARC / 01 — PROJECT REGISTRY</span>
              <h2>登记索引</h2>
            </div>
            <div className="dial-archive-registry__meta">
              <span>LOCAL WORKSPACES</span>
              <span>
                REGISTERED <b>{projects.length}</b>
              </span>
            </div>
          </header>

          {focusedProject && focusedPresentation ? (
            <>
              <ArchiveProjectStage
                project={focusedProject}
                projectIndex={focusedIndex}
                projectCount={projects.length}
                activeProjectId={content.activeProjectId}
                motionDirection={motion.direction}
                motionVersion={motion.version}
                onMove={moveProject}
                onToggleDetail={() => setDetailOpen((open) => !open)}
              />
              <div className="dial-archive-project-caption">
                <div className="dial-archive-project-caption__copy" aria-live="polite">
                  <div className="dial-archive-project-caption__count">
                    <b>{formatProjectSerial(focusedIndex + 1)}</b> /{" "}
                    <span>{formatProjectSerial(projects.length)}</span>
                  </div>
                  <h3>{focusedProject.name}</h3>
                  <p>{focusedProject.rootPath}</p>
                  <span
                    className={`dial-archive-project-caption__state is-${focusedPresentation.stateKind}`}
                  >
                    {focusedPresentation.state}
                  </span>
                </div>
                <button
                  className="dial-archive-project-detail-toggle"
                  type="button"
                  aria-expanded={detailOpen}
                  onClick={() => setDetailOpen((open) => !open)}
                >
                  <b>{detailOpen ? "收起项目档案" : "展开项目档案"}</b>
                  <em>DETAIL</em>
                </button>
              </div>
              <ArchiveProjectDetail
                project={focusedProject}
                content={content}
                open={detailOpen}
                motionVersion={motion.version}
                onClose={() => setDetailOpen(false)}
              />
            </>
          ) : (
            <div className="dial-archive-registry-empty" role="status">
              <span>
                {content.status === "loading" ? "SCANNING LOCAL REGISTRY" : "NO PROJECT REGISTERED"}
              </span>
              <h3>{content.status === "loading" ? "正在读取项目档案" : "尚未登记本地工作区"}</h3>
              <p>
                {content.status === "error"
                  ? "项目登记暂时不可用，请检查后端服务状态。"
                  : "选择一个文件夹即可建立项目档案；磁盘中的原始内容不会因此被移动。"}
              </p>
              <button
                type="button"
                disabled={content.registering}
                onClick={() => void registerProject()}
              >
                <b>{content.registering ? "正在登记工作区" : "＋ 登记新项目"}</b>
                <em>REGISTER</em>
              </button>
            </div>
          )}
        </div>
      </section>
      <footer className="dial-archive-space-footer dial-archive-space-frame">
        <span>SPACE 01 // PROJECT ARCHIVE — REGISTRY</span>
        <span>
          SCROLL DOCUMENT
          <DialArchiveBarcode className="dial-archive-space-footer__barcode" />
          THEME.R1
        </span>
      </footer>
    </article>
  );
}
