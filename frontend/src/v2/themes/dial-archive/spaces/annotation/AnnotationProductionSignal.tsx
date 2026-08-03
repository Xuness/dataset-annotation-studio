import type { CSSProperties } from "react";

import type { AnnotationSpaceContent } from "../../../../pages/spaces/spacePageModel";
import { ANNOTATION_CONTEXT_PRESENTATION } from "./model/annotationPresentation";

interface AnnotationProductionSignalProps {
  content: AnnotationSpaceContent;
}

interface ProgressStyle extends CSSProperties {
  "--annotation-operation-progress": string;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function AnnotationProductionSignal({ content }: AnnotationProductionSignalProps) {
  const operation = content.operation;
  const available = content.status === "ready" && Boolean(content.project);
  return (
    <section
      className="dial-archive-annotation-production"
      aria-labelledby="production-context-title"
    >
      <div className="dial-archive-space-frame">
        <header className="dial-archive-annotation-section-head">
          <div>
            <span>ANN / 03 — PRODUCTION CONTEXT</span>
            <h2 id="production-context-title">生产上下文</h2>
          </div>
          <p>这里确认项目和能力是否可以组成生产线路；具体文本、模型与覆盖策略在工作间中调整。</p>
        </header>

        <div className="dial-archive-annotation-production__layout">
          <div className="dial-archive-annotation-context" aria-label="项目与能力就绪性">
            <div className="dial-archive-annotation-context__axis" aria-hidden="true">
              <span>PROJECT INPUT</span>
              <i />
              <span>CAPABILITY OUTPUT</span>
            </div>
            <div className="dial-archive-annotation-context__signals">
              {content.contextSignals.map((signal, index) => {
                const presentation = ANNOTATION_CONTEXT_PRESENTATION[signal.id];
                return (
                  <article className={`is-${signal.state}`} key={signal.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{presentation.code}</b>
                    <div>
                      <h3>{presentation.label}</h3>
                      <p>{signal.detail}</p>
                    </div>
                    <em>{signal.value}</em>
                    <i aria-hidden="true" />
                  </article>
                );
              })}
              {!content.contextSignals.length ? (
                <div className="dial-archive-annotation-context__empty">
                  <b>CONTEXT REQUIRED</b>
                  <span>装载项目后才能核对生产上下文。</span>
                </div>
              ) : null}
            </div>
          </div>

          <aside className={`dial-archive-annotation-operation${operation ? " is-loaded" : ""}`}>
            <div className="dial-archive-annotation-operation__head">
              <span>{operation?.active ? "ACTIVE SIGNAL" : "LATEST SIGNAL"} //</span>
              <em>{operation?.statusLabel ?? "NO OPERATION"}</em>
            </div>
            {operation ? (
              <>
                <div className="dial-archive-annotation-operation__readout">
                  <strong>{String(operation.progressPercent).padStart(2, "0")}</strong>
                  <span>%</span>
                  <i aria-hidden="true" />
                </div>
                <div
                  className="dial-archive-annotation-operation__track"
                  style={
                    {
                      "--annotation-operation-progress": `${operation.progressPercent}%`,
                    } as ProgressStyle
                  }
                >
                  <i />
                </div>
                <dl>
                  <div>
                    <dt>OPERATION</dt>
                    <dd>{operation.id}</dd>
                  </div>
                  <div>
                    <dt>CHANNEL</dt>
                    <dd>{operation.lane?.toUpperCase() ?? operation.kind.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>PASS</dt>
                    <dd>
                      {operation.completedItems} / {operation.totalItems}
                    </dd>
                  </div>
                  <div>
                    <dt>FAILED</dt>
                    <dd>{operation.failedItems}</dd>
                  </div>
                  <div>
                    <dt>PROFILE</dt>
                    <dd>{operation.executionProfileName}</dd>
                  </div>
                  <div>
                    <dt>UPDATED</dt>
                    <dd>{formatTime(operation.updatedAt)}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => content.openProduction(operation.lane ?? undefined, operation.id)}
                >
                  <b>{operation.active ? "观察当前生产" : "打开生产记录"}</b>
                  <em>OPEN OPERATION →</em>
                </button>
              </>
            ) : (
              <div className="dial-archive-annotation-operation__empty">
                <strong>00</strong>
                <h3>还没有生产任务</h3>
                <p>可以从任一标注通道建立自动生产线路，也可以直接进入素材标注台。</p>
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => content.openProduction()}
                >
                  创建生产任务 →
                </button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
