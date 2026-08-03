import type { AnnotationSpaceContent } from "../../../../pages/spaces/spacePageModel";

interface AnnotationHeroProps {
  content: AnnotationSpaceContent;
}

function stateLabel(content: AnnotationSpaceContent): string {
  if (content.status === "no-context") return "NO CONTEXT";
  if (content.status === "loading") return "LOADING";
  if (content.status === "error") return "ATTENTION";
  if (content.operation?.active) return "PRODUCING";
  return "STANDBY";
}

export function AnnotationHero({ content }: AnnotationHeroProps) {
  const project = content.project;
  const primary = content.samples[0];
  const satellites = content.samples.slice(1, 6);
  const ready = content.status === "ready" && Boolean(project);

  return (
    <section className="dial-archive-annotation-hero" aria-labelledby="annotation-title">
      <div className="dial-archive-space-frame">
        <div
          className="dial-archive-annotation-hero__word"
          data-dial-archive-entry
          aria-hidden="true"
        >
          ANNO<span>TATION</span>
        </div>

        <div className="dial-archive-annotation-hero__layout" data-dial-archive-entry>
          <div className="dial-archive-annotation-specimen" aria-label="当前项目素材视窗">
            <button
              className={`dial-archive-annotation-specimen__main${primary ? " is-loaded" : ""}`}
              type="button"
              disabled={!primary || !ready}
              aria-label={primary ? `打开素材 ${primary.filename}` : "当前项目没有可显示素材"}
              onClick={() => primary && content.openWorkbench(primary.id)}
            >
              {primary ? (
                <img src={primary.imageUrl} alt={primary.filename} draggable={false} />
              ) : (
                <span className="dial-archive-annotation-specimen__empty">
                  <i aria-hidden="true" />
                  <b>SPECIMEN UNAVAILABLE</b>
                  <em>{content.status === "loading" ? "LOADING PROJECT INDEX" : "NO ASSET"}</em>
                </span>
              )}
              <span className="dial-archive-annotation-specimen__shade" aria-hidden="true" />
              <span
                className="dial-archive-annotation-specimen__register is-top"
                aria-hidden="true"
              />
              <span
                className="dial-archive-annotation-specimen__register is-bottom"
                aria-hidden="true"
              />
              {primary ? (
                <span className="dial-archive-annotation-specimen__caption">
                  <span>
                    <em>OBJECT // 001</em>
                    <b>{primary.filename}</b>
                  </span>
                  <span>
                    {primary.width} × {primary.height}
                    <br />
                    {primary.annotationStatus.toUpperCase()}
                  </span>
                </span>
              ) : null}
            </button>

            <div className="dial-archive-annotation-specimen__rail">
              <div className="dial-archive-annotation-specimen__rail-head">
                <span>MATERIAL SEQUENCE //</span>
                <b>
                  {String(content.samples.length).padStart(2, "0")} / {project?.assetCount ?? 0}
                </b>
              </div>
              <div className="dial-archive-annotation-specimen__satellites">
                {Array.from({ length: 5 }, (_, index) => {
                  const sample = satellites[index];
                  return (
                    <button
                      type="button"
                      className={sample ? "is-loaded" : ""}
                      key={sample?.id ?? `empty-${index}`}
                      disabled={!sample || !ready}
                      aria-label={sample ? `打开素材 ${sample.filename}` : "空素材位"}
                      onClick={() => sample && content.openWorkbench(sample.id)}
                    >
                      {sample ? (
                        <img src={sample.thumbnailUrl} alt="" draggable={false} />
                      ) : (
                        <i aria-hidden="true" />
                      )}
                      <span>{String(index + 2).padStart(3, "0")}</span>
                    </button>
                  );
                })}
              </div>
              <p title={project?.rootPath}>
                {primary?.relativePath ?? project?.rootPath ?? "PROJECT CONTEXT UNLOADED"}
              </p>
            </div>
          </div>

          <div className="dial-archive-annotation-hero__copy">
            <div className="dial-archive-space-kicker">
              <i aria-hidden="true" />
              <span>SPACE 03 // ANN</span>
            </div>
            <h1 id="annotation-title">标注生产</h1>
            <p>让真实素材、标注通道与生产线路在同一空间中保持连续。</p>

            <dl className="dial-archive-annotation-hero__facts">
              <div>
                <dt>PROJECT //</dt>
                <dd>{project?.name ?? "—"}</dd>
              </div>
              <div>
                <dt>CONTEXT //</dt>
                <dd>{project?.id ?? "NOT LOADED"}</dd>
              </div>
              <div>
                <dt>ASSETS //</dt>
                <dd>{project?.assetCount ?? "—"}</dd>
              </div>
              <div>
                <dt>SELECTED //</dt>
                <dd>{content.checkedCount || "NONE"}</dd>
              </div>
              <div>
                <dt>STATE //</dt>
                <dd className={`is-${content.status}`}>
                  <i aria-hidden="true" />
                  {stateLabel(content)}
                </dd>
              </div>
            </dl>

            <div className="dial-archive-annotation-hero__actions">
              {project ? (
                <>
                  <button
                    className="is-primary"
                    type="button"
                    disabled={!ready}
                    onClick={() => content.openWorkbench(primary?.id)}
                  >
                    <span>
                      <b>进入素材标注台</b>
                      <small>逐图检查与编辑标注对象</small>
                    </span>
                    <em>OPEN DESK →</em>
                  </button>
                  <button
                    className="is-secondary"
                    type="button"
                    disabled={!ready}
                    onClick={() => content.openProduction()}
                  >
                    <span>
                      <b>创建自动生产任务</b>
                      <small>选择通道、能力与处理范围</small>
                    </span>
                    <em>BUILD ROUTE →</em>
                  </button>
                </>
              ) : (
                <button
                  className="is-primary"
                  type="button"
                  disabled={content.status === "loading"}
                  onClick={content.openArchive}
                >
                  <span>
                    <b>进入项目档案</b>
                    <small>装载一个工作区后建立生产上下文</small>
                  </span>
                  <em>OPEN ARCHIVE →</em>
                </button>
              )}
            </div>
            {content.message ? (
              <p className="dial-archive-annotation-hero__message">{content.message}</p>
            ) : null}
          </div>
        </div>

        <div className="dial-archive-annotation-hero__foot">
          <span>OBJECT-CENTRED PRODUCTION SPACE</span>
          <span>CHANNEL MAP BELOW</span>
        </div>
      </div>
    </section>
  );
}
