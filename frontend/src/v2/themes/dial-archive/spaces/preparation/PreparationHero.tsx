import type { PreparationSpaceContent } from "../../../../pages/spaces/spacePageModel";

interface PreparationHeroProps {
  content: PreparationSpaceContent;
}

function primaryAction(content: PreparationSpaceContent) {
  if (!content.project) {
    return {
      label: content.status === "loading" ? "正在装载项目" : "进入项目档案",
      english: "OPEN ARCHIVE",
      disabled: content.status === "loading",
      run: content.openArchive,
    };
  }
  if (content.activeOperation) {
    return {
      label: content.activeOperation.status === "recovering" ? "观察恢复过程" : "观察执行过程",
      english: "OBSERVE TASK",
      disabled: false,
      run: () =>
        content.openOperation(
          content.activeOperation!.id,
          content.activeOperation!.status === "recovering" ? "recovery" : "commit",
        ),
    };
  }
  return {
    label: "创建整备任务",
    english: "CREATE TASK",
    disabled: content.status !== "ready",
    run: () => content.openWorkbench(),
  };
}

function stateLabel(content: PreparationSpaceContent): string {
  if (content.status === "no-context") return "NO CONTEXT";
  if (content.status === "loading") return "LOADING";
  if (content.status === "error") return "ATTENTION";
  if (content.activeOperation?.status === "recovering") return "RECOVERING";
  if (content.activeOperation) return "RUNNING";
  return "STANDBY";
}

export function PreparationHero({ content }: PreparationHeroProps) {
  const action = primaryAction(content);
  const project = content.project;
  const samples = content.samples.slice(0, 5);

  return (
    <section className="dial-archive-preparation-hero" aria-labelledby="preparation-title">
      <div className="dial-archive-space-frame">
        <div className="dial-archive-preparation-hero__word" aria-hidden="true">
          PREP<span>ARATION</span>
        </div>
        <div className="dial-archive-preparation-hero__layout">
          <div className="dial-archive-preparation-samples" aria-label="当前项目素材样本">
            <div className="dial-archive-preparation-samples__field">
              {Array.from({ length: 5 }, (_, index) => {
                const sample = samples[index];
                return (
                  <figure
                    className={`dial-archive-preparation-sample is-${index + 1}${sample ? " is-loaded" : ""}`}
                    key={sample?.id ?? `empty-${index}`}
                  >
                    {sample ? <img src={sample.thumbnailUrl} alt="" draggable={false} /> : null}
                    <figcaption>
                      <b>{sample?.filename ?? "ASSET PENDING"}</b>
                      <span>{sample ? `${sample.width}×${sample.height}` : "— × —"}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <div className="dial-archive-preparation-samples__baseline" aria-hidden="true" />
            <p>
              SAMPLE {String(samples.length).padStart(2, "0")} / {project?.assetCount ?? 0} —{" "}
              <b>{project?.rootPath ?? "PROJECT CONTEXT UNLOADED"}</b>
            </p>
          </div>

          <div className="dial-archive-preparation-hero__copy">
            <div className="dial-archive-space-kicker">
              <i aria-hidden="true" />
              <span>SPACE 02 // PRP — PREPARATION</span>
            </div>
            <h1 id="preparation-title">数据整备</h1>
            <p>在进入生产前，建立可预演、可追溯、可恢复的素材版本。</p>
            <div className="dial-archive-preparation-context">
              <dl>
                <dt>PROJECT //</dt>
                <dd>{project?.name ?? "—"}</dd>
                <dt>CONTEXT //</dt>
                <dd>{project?.id ?? "NOT LOADED"}</dd>
                <dt>ASSETS //</dt>
                <dd>
                  {project?.assetCount ?? "—"}
                  {project?.invalidCount ? ` · CHECK ${project.invalidCount}` : ""}
                </dd>
                <dt>SELECTED //</dt>
                <dd>{content.checkedCount || "NONE"}</dd>
                <dt>STATE //</dt>
                <dd className="dial-archive-preparation-context__state">
                  <i aria-hidden="true" />
                  {stateLabel(content)}
                </dd>
              </dl>
              <button type="button" disabled={action.disabled} onClick={action.run}>
                <b>{action.label}</b>
                <em>{action.english} →</em>
              </button>
              {content.message ? <p role="status">{content.message}</p> : null}
            </div>
          </div>
        </div>
        <div className="dial-archive-preparation-hero__foot">
          <span>SPACE 02 // PREPARATION</span>
          <span>CAPABILITY DECK BELOW</span>
        </div>
      </div>
    </section>
  );
}
