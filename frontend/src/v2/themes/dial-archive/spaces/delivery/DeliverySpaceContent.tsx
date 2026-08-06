import type { DeliverySpaceContent as DeliverySpaceContentModel } from "../../../../pages/spaces/spacePageModel";
import { DialArchiveBarcode } from "../../components/DialArchivePrimitives";
import { DeliveryExitGate } from "./DeliveryExitGate";
import { DeliveryHistoryRail } from "./DeliveryHistoryRail";
import { DeliveryManifest } from "./DeliveryManifest";

interface DeliverySpaceContentProps {
  content: DeliverySpaceContentModel;
}

function DeliveryState({ content }: DeliverySpaceContentProps) {
  const noContext = content.status === "no-context";
  return (
    <section className={`dial-archive-delivery-state is-${content.status}`}>
      <span>05 / DELIVERY</span>
      <h1>
        {noContext
          ? "尚未装载项目"
          : content.status === "loading"
            ? "正在装载交付空间"
            : "交付空间不可用"}
      </h1>
      <p>
        {content.message ??
          (noContext
            ? "先从项目档案装载一个工作区，再建立交付方案。"
            : "正在读取项目、草案与交付记录。")}
      </p>
      {content.status !== "loading" ? (
        <button type="button" onClick={content.openArchive}>
          返回 01 项目档案 <span>ARC ↗</span>
        </button>
      ) : null}
    </section>
  );
}

export function DeliverySpaceContent({ content }: DeliverySpaceContentProps) {
  if (content.status !== "ready") return <DeliveryState content={content} />;
  return (
    <article className="dial-archive-delivery-page" aria-label="发布交付空间">
      <section className="dial-archive-delivery-overview">
        <div className="dial-archive-space-frame">
          <header
            className="dial-archive-delivery-overview__header"
            data-dial-archive-delivery-entry
          >
            <div className="dial-archive-delivery-overview__handoff">
              <span>QUALITY HANDOFF // 04 → 05</span>
              <b>复核状态随项目保留，交付范围在这里确认</b>
            </div>
            <div className="dial-archive-delivery-overview__identity">
              <span>SPACE 05 // DLV — DELIVERY</span>
              <h1>
                发布<i>交付</i>
              </h1>
              <p>编组素材与标注修订，将冻结清单写到项目边界之外。</p>
            </div>
            <div className="dial-archive-delivery-overview__project">
              <span>PROJECT //</span>
              <b>{content.project?.name}</b>
              <em>{content.project?.id}</em>
            </div>
          </header>

          <div className="dial-archive-delivery-overview__stage" data-dial-archive-delivery-entry>
            <div className="dial-archive-delivery-overview__word" aria-hidden="true">
              OUTBOUND
            </div>
            <DeliveryManifest
              manifest={content.manifest}
              project={content.project}
              operation={content.focusOperation}
            />
            <div className="dial-archive-delivery-overview__route" aria-hidden="true">
              <span />
              <i />
              <b>OUT</b>
            </div>
            <DeliveryExitGate content={content} />
          </div>

          <DeliveryHistoryRail
            operations={content.operations}
            onSelect={(operationId) => content.openWorkbench(operationId)}
            onCreate={() => content.openWorkbench()}
          />

          <footer className="dial-archive-space-footer dial-archive-delivery-overview__footer">
            <span>SPACE 05 // DELIVERY — FREEZE, MATERIALIZE, TRACE</span>
            <span>
              OUTBOUND REGISTER
              <DialArchiveBarcode className="dial-archive-space-footer__barcode" />
              THEME.R2
            </span>
          </footer>
        </div>
      </section>
    </article>
  );
}
