import type { KeyboardEvent } from "react";

import type { ArchiveProjectRecord } from "../../../../pages/spaces/spacePageModel";
import { formatProjectSerial, presentArchiveProject } from "../model/projectPresentation";

interface ArchiveProjectStageProps {
  project: ArchiveProjectRecord;
  projectIndex: number;
  projectCount: number;
  activeProjectId: string | null;
  motionDirection: -1 | 0 | 1;
  motionVersion: number;
  onMove(delta: number): void;
  onToggleDetail(): void;
}

export function ArchiveProjectStage({
  project,
  projectIndex,
  projectCount,
  activeProjectId,
  motionDirection,
  motionVersion,
  onMove,
  onToggleDetail,
}: ArchiveProjectStageProps) {
  const serial = formatProjectSerial(projectIndex + 1);
  const total = formatProjectSerial(projectCount);
  const presentation = presentArchiveProject(project, activeProjectId);
  const motionClass =
    motionDirection === 0
      ? ""
      : motionDirection < 0
        ? " is-changing is-prev"
        : " is-changing is-next";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onMove(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onMove(event.key === "Home" ? -projectIndex : projectCount - projectIndex - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleDetail();
    }
  };

  return (
    <div
      className={`dial-archive-project-stage${motionClass}`}
      tabIndex={0}
      role="group"
      aria-label={`项目 ${serial}/${total}，${project.name}，使用左右方向键切换项目`}
      onKeyDown={handleKeyDown}
    >
      <div className="dial-archive-project-visual">
        <div
          className="dial-archive-project-orbit"
          key={`orbit-${motionVersion}`}
          aria-hidden="true"
        >
          <i />
        </div>
        <div
          className="dial-archive-project-visual__content"
          key={`project-${project.id}-${motionVersion}`}
        >
          <div className="dial-archive-project-visual__top">
            <span>LOCAL WORKSPACE // REGISTERED</span>
            <span className={`is-${presentation.stateKind}`}>{presentation.state}</span>
          </div>
          <span className="dial-archive-project-visual__serial" aria-hidden="true">
            {serial}
          </span>
          <div className="dial-archive-project-visual__identity">
            <span className="dial-archive-project-visual__id">{project.id}</span>
            <strong className="dial-archive-project-visual__name">{project.name}</strong>
            <span className="dial-archive-project-visual__path">{project.rootPath}</span>
            <div className="dial-archive-project-visual__metrics">
              <span>
                ASSETS <b>{presentation.assetCount}</b>
              </span>
              <span>
                ANNOTATED <b>{presentation.annotatedCount}</b>
              </span>
              <span>
                INVALID <b>{presentation.invalidCount}</b>
              </span>
              <span>
                UPD <b>{presentation.updatedShort}</b>
              </span>
            </div>
          </div>
        </div>
      </div>
      <aside className="dial-archive-project-marker" aria-hidden="true">
        <span className="dial-archive-project-marker__word">PROJECT</span>
        <span className="dial-archive-project-marker__micro">
          REGISTERED LOCAL WORKSPACE / DATASET STUDIO
        </span>
        <span className="dial-archive-project-marker__index" key={`index-${motionVersion}`}>
          {serial} / {total}
        </span>
      </aside>
      <div className="dial-archive-project-nav" aria-label="切换项目">
        <button
          className="dial-archive-project-nav__prev"
          type="button"
          aria-label="上一个项目"
          disabled={projectCount < 2}
          onClick={() => onMove(-1)}
        />
        <button
          className="dial-archive-project-nav__next"
          type="button"
          aria-label="下一个项目"
          disabled={projectCount < 2}
          onClick={() => onMove(1)}
        />
      </div>
    </div>
  );
}
