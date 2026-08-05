import type { AnnotationProductionOperation as ProductionOperation } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationProductionOperationProps {
  operation: ProductionOperation;
  message: string | null;
  onCreateNew(): void;
}

function OperationActionBar({
  operation,
  onCreateNew,
}: {
  operation: ProductionOperation;
  onCreateNew(): void;
}) {
  return (
    <div className="dial-archive-production-operation__actions">
      {operation.canStop ? (
        <button
          className="dial-archive-preparation-inspector__primary"
          type="button"
          disabled={operation.stopping || operation.actionPending}
          onClick={() => void operation.stop()}
        >
          <span>INTERRUPT</span>
          <b>{operation.stopping ? "正在停止" : "停止任务"}</b>
        </button>
      ) : null}
      {operation.canResume ? (
        <button
          className="is-primary dial-archive-preparation-inspector__primary"
          type="button"
          disabled={operation.actionPending}
          onClick={() => void operation.resume()}
        >
          <span>CONTINUE</span>
          <b>继续任务</b>
        </button>
      ) : null}
      {operation.canRetry ? (
        <button
          className="dial-archive-preparation-inspector__primary"
          type="button"
          disabled={operation.actionPending}
          onClick={() => void operation.retry()}
        >
          <span>FAILED BRANCH</span>
          <b>仅重试失败项</b>
        </button>
      ) : null}
      {!operation.canStop ? (
        <button
          className="is-primary dial-archive-preparation-inspector__primary"
          type="button"
          onClick={onCreateNew}
        >
          <span>NEW ROUTE</span>
          <b>建立新生产任务</b>
        </button>
      ) : null}
    </div>
  );
}

export function AnnotationProductionOperation({
  operation,
  message,
  onCreateNew,
}: AnnotationProductionOperationProps) {
  const metrics = [
    ["TOTAL", operation.total],
    ["SUCCESS", operation.succeeded],
    ["RUNNING", operation.running],
    ["FAILED", operation.failed],
    ["CANDIDATE", operation.candidates],
  ] as const;

  return (
    <section
      className={`dial-archive-production-operation is-${operation.tone}`}
      id="annotation-production-console"
      aria-label="生产任务执行记录"
      aria-live={operation.tone === "active" ? "polite" : "off"}
    >
      <section className="dial-archive-preparation-inspector__operation">
        <div className="dial-archive-production-operation__register">
          <span>OPERATION</span>
          <b>{operation.id}</b>
        </div>

        <dl className="dial-archive-production-operation__readout">
          <div>
            <dt>STATUS</dt>
            <dd>{operation.statusLabel}</dd>
          </div>
          <div>
            <dt>PASS</dt>
            <dd>
              <b>{operation.progressPercent}</b>%
            </dd>
          </div>
          <div>
            <dt>ROUTE</dt>
            <dd>{operation.lane.toUpperCase()}</dd>
          </div>
          <div>
            <dt>BACKEND</dt>
            <dd>{operation.executionProfile}</dd>
          </div>
        </dl>
      </section>

      <div className="dial-archive-production-operation__metrics dial-archive-preparation-inspector__metrics">
        {metrics.map(([label, value]) => (
          <span className={label === "FAILED" && value ? "is-warning" : undefined} key={label}>
            {label}
            <b>{value.toLocaleString()}</b>
          </span>
        ))}
      </div>

      <div className="dial-archive-production-operation__ledger">
        <details className="dial-archive-production-operation__snapshot">
          <summary>
            <span>LOCKED EXECUTION SNAPSHOT</span>
            <b>{operation.snapshot.length.toString().padStart(2, "0")} READINGS</b>
          </summary>
          <dl>
            {operation.snapshot.map((field) => (
              <div key={field.id}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
                {field.detail ? <small>{field.detail}</small> : null}
              </div>
            ))}
          </dl>
        </details>

        <section className="dial-archive-production-exceptions" aria-label="异常分支">
          <header>
            <span>EXCEPTION BRANCH</span>
            <b>
              {operation.exceptions.length} / {operation.exceptionCount}
            </b>
          </header>
          {operation.exceptions.length > 0 ? (
            <div className="dial-archive-production-exceptions__list">
              {operation.exceptions.map((exception) => (
                <article
                  className={`dial-archive-preparation-inspector__preview-item${
                    exception.candidate ? " is-candidate" : ""
                  }`}
                  key={exception.id}
                >
                  <header>
                    <span>
                      {exception.candidate ? "CANDIDATE" : exception.status.toUpperCase()}
                    </span>
                    <b title={exception.relativePath}>{exception.relativePath}</b>
                    <small>{exception.attemptCount} ATTEMPT</small>
                  </header>
                  <p>{exception.message}</p>
                  {exception.diagnostic ? <pre>{exception.diagnostic}</pre> : null}
                  {exception.canAccept ? (
                    <button
                      type="button"
                      disabled={operation.actionPending}
                      onClick={() => void operation.accept(exception.id)}
                    >
                      人工确认并写入当前线路
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="dial-archive-production-exceptions__empty">
              <span>NO DIVERGENCE</span>
              <p>当前生产线路没有失败项或候选修订。</p>
            </div>
          )}
          {operation.canLoadMore ? (
            <button
              className="dial-archive-production-exceptions__more"
              type="button"
              disabled={operation.loadingMore}
              onClick={operation.loadMore}
            >
              {operation.loadingMore ? "正在读取异常分支" : "载入更多异常项"}
            </button>
          ) : null}
        </section>
      </div>

      {message ? <p className="dial-archive-production-operation__error">{message}</p> : null}
      <OperationActionBar operation={operation} onCreateNew={onCreateNew} />
    </section>
  );
}
