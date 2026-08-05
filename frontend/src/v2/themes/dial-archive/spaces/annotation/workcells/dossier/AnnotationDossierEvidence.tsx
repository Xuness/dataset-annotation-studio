import type {
  AnnotationDossierContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface AnnotationDossierEvidenceProps {
  asset: AnnotationStageAsset;
  dossier: AnnotationDossierContent;
}

/**
 * Identity plate for the shared stage specimen. The image itself deliberately
 * stays in AnnotationSpecimen so stage and dossier use one continuous object.
 */
export function AnnotationDossierEvidence({ asset, dossier }: AnnotationDossierEvidenceProps) {
  const currentDocuments = dossier.documents.filter(
    (document) => document.availability === "usable" && document.status !== "missing",
  ).length;

  return (
    <aside className="dial-archive-dossier-evidence" aria-label="当前对象证据台">
      <header className="dial-archive-dossier-evidence__head">
        <span>SPECIMEN LOCK // SHARED OBJECT</span>
        <b>{asset.filename}</b>
        <small title={asset.relativePath}>{asset.relativePath}</small>
      </header>

      <div className="dial-archive-dossier-evidence__continuity" aria-hidden="true">
        <span>TRUE COLOR EVIDENCE</span>
        <b>
          {asset.width} × {asset.height}
        </b>
        <i />
      </div>

      <dl className="dial-archive-dossier-evidence__facts">
        <div>
          <dt>OBJECT ID</dt>
          <dd title={asset.id}>{asset.id}</dd>
        </div>
        <div>
          <dt>FILE TYPE</dt>
          <dd>{asset.suffix.replace(/^\./u, "").toUpperCase() || "—"}</dd>
        </div>
        <div>
          <dt>BYTE SIZE</dt>
          <dd>{formatByteSize(asset.byteSize)}</dd>
        </div>
        <div>
          <dt>REGISTER</dt>
          <dd>
            {currentDocuments.toString().padStart(2, "0")} /{" "}
            {dossier.documents.length.toString().padStart(2, "0")}
          </dd>
        </div>
      </dl>

      <footer className="dial-archive-dossier-evidence__seal">
        <span>READ ONLY</span>
        <b>{asset.annotationStatus.toUpperCase()}</b>
        <i aria-hidden="true" />
      </footer>
    </aside>
  );
}
