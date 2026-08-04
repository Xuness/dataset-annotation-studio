import { useState } from "react";

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

export function AnnotationDossierEvidence({ asset, dossier }: AnnotationDossierEvidenceProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const currentDocuments = dossier.documents.filter(
    (document) => document.availability === "usable" && document.status !== "missing",
  ).length;

  return (
    <aside className="dial-archive-dossier-evidence" aria-label="当前对象证据台">
      <div className="dial-archive-dossier-evidence__index" aria-hidden="true">
        <span>OBJECT</span>
        <b>03</b>
      </div>

      <header className="dial-archive-dossier-evidence__head">
        <span>SPECIMEN LOCK // CURRENT OBJECT</span>
        <b>{asset.filename}</b>
        <small title={asset.relativePath}>{asset.relativePath}</small>
      </header>

      <figure className="dial-archive-dossier-evidence__plate">
        <i className="is-top-left" aria-hidden="true" />
        <i className="is-top-right" aria-hidden="true" />
        <i className="is-bottom-left" aria-hidden="true" />
        <i className="is-bottom-right" aria-hidden="true" />
        {imageFailed ? (
          <div role="img" aria-label={`${asset.filename} 图像不可用`}>
            <span>IMAGE EVIDENCE UNAVAILABLE</span>
            <b>{asset.suffix.replace(/^\./u, "").toUpperCase() || "UNKNOWN"}</b>
          </div>
        ) : (
          <img src={asset.imageUrl} alt={asset.filename} onError={() => setImageFailed(true)} />
        )}
        <figcaption>
          <span>TRUE COLOR EVIDENCE</span>
          <b>
            {asset.width} × {asset.height}
          </b>
        </figcaption>
      </figure>

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
