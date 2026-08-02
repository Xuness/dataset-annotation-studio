import type { ArchiveSpaceContent } from "../../../../pages/spaces/spacePageModel";

interface ArchiveHeroProps {
  content: ArchiveSpaceContent;
  onRegisterProject(): void;
}

export function ArchiveHero({ content, onRegisterProject }: ArchiveHeroProps) {
  const activeProject = content.projects.find((project) => project.id === content.activeProjectId);
  return (
    <section className="dial-archive-space-hero">
      <div className="dial-archive-space-frame">
        <div className="dial-archive-space-hero__word" data-dial-archive-entry aria-hidden="true">
          ARCHIVE
        </div>
        <div className="dial-archive-space-hero__axis" aria-hidden="true" />
        <div className="dial-archive-space-hero__grid" data-dial-archive-entry>
          <div className="dial-archive-space-hero__copy">
            <div className="dial-archive-space-kicker">
              <i aria-hidden="true" />
              <span>SPACE 01 // ARC — PROJECT ARCHIVE</span>
            </div>
            <h1>项目档案</h1>
            <p>登记工作区 · 建立项目上下文 · 进入数据生产</p>
          </div>
          <aside className="dial-archive-space-hero__context" aria-label="当前项目上下文">
            <dl>
              <dt>CONTEXT //</dt>
              <dd>{activeProject?.name ?? "NOT LOADED"}</dd>
              <dt>PROJECT //</dt>
              <dd>{activeProject?.id ?? "—"}</dd>
              <dt>STATE //</dt>
              <dd>
                <span className="dial-archive-space-hero__state">
                  <i aria-hidden="true" />
                  {activeProject ? "LOADED" : "STANDBY"}
                </span>
              </dd>
            </dl>
            <button
              className="dial-archive-space-hero__register"
              type="button"
              disabled={content.registering}
              onClick={onRegisterProject}
            >
              <b>{content.registering ? "正在登记工作区" : "＋ 登记新项目"}</b>
              <em>{content.registering ? "SCANNING" : "REGISTER"}</em>
            </button>
            {content.message ? (
              <div className="dial-archive-space-message" role="alert">
                <span>{content.message}</span>
                <button type="button" onClick={content.clearMessage} aria-label="关闭提示">
                  ×
                </button>
              </div>
            ) : null}
          </aside>
        </div>
        <div className="dial-archive-space-hero__foot">
          <span>SPACE 01 // PROJECT ARCHIVE</span>
          <span className="dial-archive-space-hero__scroll">REGISTRY BELOW</span>
        </div>
      </div>
    </section>
  );
}
