import type { CSSProperties } from "react";

import type { AnnotationProductionOperation as ProductionOperation } from "../../../../../../pages/spaces/spacePageModel";
import {
  ProductionInstrumentHeader,
  ProductionPhaseRail,
} from "./AnnotationProductionInstrumentChrome";

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
          className="is-primary"
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
          type="button"
          disabled={operation.actionPending}
          onClick={() => void operation.retry()}
        >
          <span>FAILED BRANCH</span>
          <b>仅重试失败项</b>
        </button>
      ) : null}
      {!operation.canStop ? (
        <button className="is-primary" type="button" onClick={onCreateNew}>
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
      <ProductionInstrumentHeader
        lane={operation.lane}
        register={`OPERATION REGISTER // ${operation.id}`}
        title={operation.statusLabel}
        detail={
          <>
            {operation.scopeLabel} · {operation.executionProfile} ·{" "}
            {operation.model || "LOCAL PIPELINE"}
          </>
        }
      />

      <ProductionPhaseRail
        active={operation.tone === "active" ? "run" : "result"}
        label="任务阶段"
      />

      <div className="dial-archive-production-operation__progress">
        <output>{operation.progressPercent.toString().padStart(2, "0")}</output>
        <div>
          <span>PERCENT COMPLETE</span>
          <b>{operation.running ? `${operation.running} ITEM IN FLIGHT` : operation.statusLabel}</b>
        </div>
        <i
          style={
            {
              "--dial-archive-production-progress": `${operation.progressPercent}%`,
            } as CSSProperties
          }
        />
      </div>

      <dl className="dial-archive-production-operation__metrics">
        {metrics.map(([label, value]) => (
          <div className={label === "FAILED" && value ? "is-attention" : undefined} key={label}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <div className="dial-archive-production-operation__ledger">
        <div className="dial-archive-production-operation__snapshot">
          <span>LOCKED EXECUTION SNAPSHOT</span>
          <dl>
            {operation.snapshot.map((field) => (
              <div key={field.id}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
                {field.detail ? <small>{field.detail}</small> : null}
              </div>
            ))}
          </dl>
        </div>

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
                  className={exception.candidate ? "is-candidate" : undefined}
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
