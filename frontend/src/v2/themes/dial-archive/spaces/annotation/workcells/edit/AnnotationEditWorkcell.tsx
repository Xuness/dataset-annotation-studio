import type {
  AnnotationCoverageLane,
  AnnotationLaneId,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_LANE_PRESENTATION } from "../../model/annotationPresentation";
import { readAssetChannelStates } from "../../stage/model/annotationStagePresentation";

interface AnnotationEditWorkcellProps {
  asset: AnnotationStageAsset | null;
  channels: readonly AnnotationCoverageLane[];
  activeChannel: AnnotationLaneId;
  checkedCount: number;
  onSelectChannel(channel: AnnotationLaneId): void;
}

/**
 * EDIT 四级工作间的首轮视觉骨架。
 * 当前只消费真实对象身份与通道状态；标注草稿、历史和保存动作将在中立控制器接入后填入预留面。
 */
export function AnnotationEditWorkcell({
  asset,
  channels,
  activeChannel,
  checkedCount,
  onSelectChannel,
}: AnnotationEditWorkcellProps) {
  const readings = readAssetChannelStates(asset);
  const activeReading = readings.find((reading) => reading.lane === activeChannel) ?? readings[0];
  const presentation = ANNOTATION_LANE_PRESENTATION[activeChannel];
  const coverage = channels.find((channel) => channel.id === activeChannel);

  return (
    <div className="dial-archive-edit-workcell">
      <div className="dial-archive-edit-workcell__ghost" aria-hidden="true">
        EDIT
      </div>

      <aside className="dial-archive-edit-workcell__object" aria-label="当前编辑对象">
        <span>OBJECT LOCK // CURRENT</span>
        <b>{asset?.filename ?? "NO MATERIAL"}</b>
        <small>{asset?.relativePath ?? "当前序列没有可编辑素材"}</small>
        <dl>
          <div>
            <dt>SIZE</dt>
            <dd>{asset ? `${asset.width} × ${asset.height}` : "—"}</dd>
          </div>
          <div>
            <dt>FORMAT</dt>
            <dd>{asset?.suffix.replace(/^\./u, "").toUpperCase() || "—"}</dd>
          </div>
          <div>
            <dt>RANGE</dt>
            <dd>{checkedCount > 0 ? `${checkedCount} MATERIAL` : "CURRENT ONLY"}</dd>
          </div>
        </dl>
      </aside>

      <section
        className="dial-archive-edit-workcell__console"
        aria-labelledby="edit-workcell-title"
      >
        <header className="dial-archive-edit-workcell__heading">
          <span>WC.01 // CHANNEL INSTRUMENT</span>
          <h2 id="edit-workcell-title">标注编辑</h2>
          <output>
            {activeReading.code} / {activeReading.stateCode}
          </output>
        </header>

        <nav className="dial-archive-edit-workcell__channels" aria-label="标注编辑通道">
          {readings.map((reading) => {
            const lane = ANNOTATION_LANE_PRESENTATION[reading.lane];
            const active = reading.lane === activeChannel;
            return (
              <button
                className={active ? "is-active" : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectChannel(reading.lane)}
                key={reading.lane}
              >
                <span>{lane.code}</span>
                <b>{lane.title}</b>
                <em>{reading.stateCode}</em>
              </button>
            );
          })}
        </nav>

        <div className="dial-archive-edit-workcell__sheet">
          <i className="dial-archive-edit-workcell__sheet-register" aria-hidden="true" />
          <header>
            <span>{presentation.code} // ACTIVE CHANNEL</span>
            <h3>{presentation.manualAction}</h3>
            <p>{presentation.description}</p>
          </header>
          <dl className="dial-archive-edit-workcell__readings">
            <div>
              <dt>OBJECT STATE</dt>
              <dd>{activeReading.state.toUpperCase()}</dd>
            </div>
            <div>
              <dt>PROJECT COVERAGE</dt>
              <dd>{coverage ? `${coverage.coveragePercent}%` : "—"}</dd>
            </div>
            <div>
              <dt>USABLE / PRESENT</dt>
              <dd>
                {coverage ? `${coverage.usableAssetCount} / ${coverage.presentAssetCount}` : "—"}
              </dd>
            </div>
          </dl>
          <div className="dial-archive-edit-workcell__module" role="status">
            <span>EDITOR MODULE // RESERVED INTERFACE</span>
            <b>标注读写模块将在此处接入</b>
            <p>本轮先验证对象、轨道与工作间的空间连续性，不伪造尚未读取的标注正文。</p>
            <div aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <footer>
            <span>CURRENT OBJECT // {asset?.id ?? "—"}</span>
            <span>WRITE SURFACE // CONTRACT PENDING</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
