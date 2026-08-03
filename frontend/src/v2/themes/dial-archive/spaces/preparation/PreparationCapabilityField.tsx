import {
  PREPARATION_CAPABILITY_IDS,
  type PreparationSpaceContent,
} from "../../../../pages/spaces/spacePageModel";
import { PREPARATION_CAPABILITY_PRESENTATION } from "./model/preparationPresentation";

interface PreparationCapabilityFieldProps {
  content: PreparationSpaceContent;
}

export function PreparationCapabilityField({ content }: PreparationCapabilityFieldProps) {
  const available = content.status === "ready" && Boolean(content.project);
  return (
    <section className="dial-archive-preparation-capabilities" aria-labelledby="capability-title">
      <div className="dial-archive-space-frame">
        <header className="dial-archive-preparation-section-head">
          <div>
            <span>PRP / 02 — CAPABILITY DECK</span>
            <h2 id="capability-title">选择整备方向</h2>
          </div>
          <p>这里决定从哪个对象进入任务画布；参数、预演与提交将在同一个三级工作间中完成。</p>
        </header>

        <div className="dial-archive-preparation-capability-field">
          <svg viewBox="0 0 1500 690" aria-hidden="true">
            <path d="M 42 116 C 214 116 252 72 420 72 S 662 160 822 160" />
            <path d="M 1460 332 C 1288 332 1228 286 1090 286 S 906 360 770 360" />
            <path d="M 86 596 C 268 596 318 526 476 526 S 720 642 930 642" />
          </svg>
          {PREPARATION_CAPABILITY_IDS.map((capabilityId, index) => {
            const capability = PREPARATION_CAPABILITY_PRESENTATION[capabilityId];
            const sample = content.samples[index];
            return (
              <button
                className={`dial-archive-preparation-capability is-${capabilityId}`}
                type="button"
                key={capabilityId}
                disabled={!available}
                aria-label={`进入${capability.title}任务配置`}
                onClick={() => content.openWorkbench(capabilityId)}
              >
                <span className="dial-archive-preparation-capability__visual">
                  {sample ? <img src={sample.thumbnailUrl} alt="" draggable={false} /> : null}
                  <span className="dial-archive-preparation-capability__shade" />
                  <span className="dial-archive-preparation-capability__index">
                    {String(index + 1).padStart(2, "0")} / 03
                  </span>
                  <span className="dial-archive-preparation-capability__copy">
                    <em>{capability.code}</em>
                    <b>{capability.title}</b>
                    <small>{capability.description}</small>
                  </span>
                  <span className="dial-archive-preparation-capability__parameters">
                    {capability.parameters}
                  </span>
                  <span className="dial-archive-preparation-capability__enter">ENTER NODE →</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
