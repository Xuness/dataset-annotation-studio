import type { QualitySpaceContent } from "../../../../pages/spaces/spacePageModel";
import { DialArchiveBarcode } from "../../components/DialArchivePrimitives";

interface QualityHandoffProps {
  content: QualitySpaceContent;
}

export function QualityHandoff({ content }: QualityHandoffProps) {
  const attention =
    (content.statusCounts.needs_review ?? 0) +
    (content.statusCounts.invalid ?? 0) +
    (content.statusCounts.failed ?? 0);
  const total = content.project?.assetCount ?? 0;

  return (
    <section className="dial-archive-quality-handoff" aria-labelledby="quality-handoff-title">
      <div className="dial-archive-space-frame">
        <header>
          <span>QUALITY HANDOFF // 04 → 05</span>
          <h2 id="quality-handoff-title">检查结果与交付准备</h2>
          <p>复核是可选的核查支线；无论是否判定，项目都可以携带当前状态继续进入导出。</p>
        </header>

        <div className="dial-archive-quality-handoff__route">
          <div className="dial-archive-quality-handoff__numbers">
            <span>
              <em>TOTAL //</em>
              <b>{String(total).padStart(2, "0")}</b>
              <small>当前项目交付范围</small>
            </span>
            <span>
              <em>FLAGGED //</em>
              <b>{String(attention).padStart(2, "0")}</b>
              <small>可带状态继续或稍后复核</small>
            </span>
            <span>
              <em>SELECTED //</em>
              <b>{String(content.checkedCount).padStart(2, "0")}</b>
              <small>沿用当前项目选区</small>
            </span>
          </div>

          <div className="dial-archive-quality-handoff__axis" aria-hidden="true">
            <span>03</span>
            <i />
            <b>04</b>
            <i />
            <span>05</span>
          </div>

          <div className="dial-archive-quality-handoff__actions">
            <button
              className="is-primary"
              type="button"
              disabled={!content.project}
              onClick={content.openDelivery}
            >
              <span>
                <b>继续至 05 导出</b>
                <small>无需完成复核，携带当前状态前往 05</small>
              </span>
              <em>HANDOFF →</em>
            </button>
            <button
              type="button"
              disabled={!content.focusAsset}
              onClick={() => content.openAnnotation()}
            >
              返回 03 修订当前对象
            </button>
          </div>
        </div>

        <footer className="dial-archive-space-footer">
          <span>SPACE 04 // QUALITY — EVIDENCE BEFORE VERDICT</span>
          <span>
            TRACE CONTINUITY
            <DialArchiveBarcode className="dial-archive-space-footer__barcode" />
            THEME.R2
          </span>
        </footer>
      </div>
    </section>
  );
}
