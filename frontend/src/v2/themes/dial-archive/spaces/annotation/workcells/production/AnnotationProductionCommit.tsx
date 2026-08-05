import type {
  AnnotationLaneId,
  AnnotationProductionConfiguration as ProductionConfiguration,
} from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_PRODUCTION_LANE_PRESENTATION } from "./model/annotationProductionPresentation";

interface AnnotationProductionCommitProps {
  lane: AnnotationLaneId;
  configuration: ProductionConfiguration;
  message: string | null;
}

export function AnnotationProductionCommit({
  lane,
  configuration,
  message,
}: AnnotationProductionCommitProps) {
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[lane];
  const blocked = configuration.blockers.length > 0;

  return (
    <section
      className="dial-archive-production-commit"
      id="annotation-production-console"
      role="tabpanel"
      aria-label="合流写入"
    >
      <header className="dial-archive-production-commit__overview">
        <span>VALIDATE / FREEZE / WRITE</span>
        <b>{blocked ? "INTERLOCK" : "ROUTE CLEAR"}</b>
        <h3>冻结执行快照</h3>
        <p>汇总当前支路参数与素材范围，通过校验后建立唯一生产任务。</p>
        <i className="dial-archive-production-commit__index" aria-hidden="true">
          03
        </i>
      </header>

      <ol className="dial-archive-production-commit__sequence" aria-label="合流写入阶段">
        <li className="is-complete">
          <span>01</span>
          <b>支路配置</b>
        </li>
        <li className={blocked ? "is-attention" : "is-complete"}>
          <span>02</span>
          <b>冻结校验</b>
        </li>
        <li className={blocked ? undefined : "is-ready"}>
          <span>03</span>
          <b>队列写入</b>
        </li>
      </ol>

      <dl className="dial-archive-production-commit__readings">
        <div>
          <dt>LANE</dt>
          <dd>{identity.code}</dd>
        </div>
        <div>
          <dt>MATERIAL</dt>
          <dd>{configuration.scopeCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>STATE</dt>
          <dd>{blocked ? `${configuration.blockers.length} LOCK` : "ARMED"}</dd>
        </div>
      </dl>

      <details className="dial-archive-production-snapshot">
        <summary>
          <span>FROZEN EXECUTION SNAPSHOT</span>
          <b>{configuration.snapshot.length.toString().padStart(2, "0")} READINGS</b>
        </summary>
        <dl>
          {configuration.snapshot.map((field) => (
            <div className={field.tone ? `is-${field.tone}` : undefined} key={field.id}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
              {field.detail ? <small>{field.detail}</small> : null}
            </div>
          ))}
        </dl>
      </details>

      {blocked ? (
        <div
          className="dial-archive-production-blockers dial-archive-preparation-inspector__error"
          role="status"
        >
          <span>INTERLOCK // {configuration.blockers.length.toString().padStart(2, "0")}</span>
          <ul>
            {configuration.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="dial-archive-production-ready" role="status">
          <span>ROUTE VALIDATED</span>
          <b>{configuration.scopeCount.toLocaleString()} MATERIAL READY</b>
        </div>
      )}

      {message ? (
        <p className="dial-archive-production-console__error dial-archive-preparation-inspector__error">
          {message}
        </p>
      ) : null}

      <button
        className="dial-archive-production-launch dial-archive-preparation-inspector__primary"
        type="button"
        disabled={!configuration.ready || configuration.pending}
        onClick={() => {
          if (configuration.ready && !configuration.pending) void configuration.create();
        }}
      >
        <b>{configuration.pending ? "正在建立任务" : "建立并启动生产任务"}</b>
        <em>{configuration.pending ? "CREATING OPERATION" : "COMMIT ROUTE →"}</em>
      </button>
    </section>
  );
}
