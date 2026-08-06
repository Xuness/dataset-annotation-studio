import type {
  AnnotationProjectContext,
  DeliveryManifestSummary,
  DeliveryOperationSummary,
} from "../../../../pages/spaces/spacePageModel";

interface DeliveryManifestProps {
  manifest: DeliveryManifestSummary;
  project: AnnotationProjectContext | null;
  operation?: DeliveryOperationSummary | null;
  compact?: boolean;
}

export function DeliveryManifest({
  manifest,
  project,
  operation = null,
  compact = false,
}: DeliveryManifestProps) {
  const visibleSelections = manifest.selections.slice(0, 3);
  const hiddenSelectionCount = manifest.selections.length - visibleSelections.length;
  return (
    <section
      className={`dial-archive-delivery-manifest${compact ? " is-compact" : ""}`}
      aria-labelledby="delivery-manifest-title"
      data-source={manifest.source}
    >
      <span className="dial-archive-delivery-manifest__sheet is-back" aria-hidden="true" />
      <span className="dial-archive-delivery-manifest__sheet is-middle" aria-hidden="true" />

      <div className="dial-archive-delivery-manifest__register" aria-hidden="true">
        <b>05</b>
        <span>DLV</span>
        <i />
        <em>OUTBOUND</em>
      </div>

      <div className="dial-archive-delivery-manifest__document">
        <header>
          <div>
            <span>
              OUTBOUND MANIFEST // {manifest.source === "operation" ? "SNAPSHOT" : "SESSION"}
            </span>
            <h2 id="delivery-manifest-title">发布清单</h2>
          </div>
          <div className="dial-archive-delivery-manifest__identity">
            <span>
              {operation ? `OP.${operation.shortId}` : manifest.draft ? "DRAFT.OPEN" : "DRAFT.NEW"}
            </span>
            <b>{project?.name ?? "NO PROJECT"}</b>
          </div>
        </header>

        <div className="dial-archive-delivery-manifest__scope">
          <span>
            <em>SCOPE //</em>
            <b>{manifest.scopeLabel}</b>
          </span>
          <strong>{String(manifest.itemCount).padStart(2, "0")}</strong>
          <small>OBJECTS</small>
        </div>

        <div className="dial-archive-delivery-manifest__selections">
          <div className="dial-archive-delivery-manifest__section-label">
            <span>CHANNEL REGISTER //</span>
            <i />
            <span>{String(manifest.selections.length).padStart(2, "0")}</span>
          </div>
          {visibleSelections.length ? (
            visibleSelections.map((selection, index) => (
              <div className="dial-archive-delivery-manifest__selection" key={selection.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{selection.code}</b>
                <span>
                  <strong>{selection.label}</strong>
                  <small>{selection.detail}</small>
                </span>
                <em>{selection.revisionLabel}</em>
              </div>
            ))
          ) : (
            <p className="dial-archive-delivery-manifest__empty">尚未编组标注通道。</p>
          )}
          {hiddenSelectionCount > 0 ? (
            <div className="dial-archive-delivery-manifest__more">
              + {String(hiddenSelectionCount).padStart(2, "0")} TRANSLATION LANES
            </div>
          ) : null}
        </div>

        <div className="dial-archive-delivery-manifest__output">
          <span>
            <em>FORMAT //</em>
            <b>{manifest.formatLabel}</b>
          </span>
          <span>
            <em>PACKAGE //</em>
            <b>{manifest.packagingLabel}</b>
          </span>
        </div>

        <footer>
          <span>DESTINATION //</span>
          <b title={manifest.destinationPath}>{manifest.destinationLabel}</b>
          <em>{manifest.destinationPath || "使用交付台选择外部目录"}</em>
        </footer>
      </div>
    </section>
  );
}
