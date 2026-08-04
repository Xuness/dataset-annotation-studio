import type {
  AnnotationDossierContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import { AnnotationDossierEvidence } from "./AnnotationDossierEvidence";
import { AnnotationDossierRegister } from "./AnnotationDossierRegister";

interface AnnotationDossierWorkcellProps {
  asset: AnnotationStageAsset | null;
  dossier: AnnotationDossierContent | null;
}

export function AnnotationDossierWorkcell({ asset, dossier }: AnnotationDossierWorkcellProps) {
  if (!dossier || dossier.status === "inactive") {
    return (
      <div className="dial-archive-dossier-state" role="status">
        <span>DOSSIER CONTRACT // WAITING</span>
        <b>对象档案正在与当前素材建立联系</b>
      </div>
    );
  }

  if (!asset || dossier.status === "no-object") {
    return (
      <div className="dial-archive-dossier-state" role="status">
        <span>OBJECT REGISTER // NO MATERIAL</span>
        <b>当前序列没有可归档对象</b>
      </div>
    );
  }

  if (dossier.status === "loading") {
    return (
      <div className="dial-archive-dossier-state is-loading" role="status">
        <span>READING IMMUTABLE EVIDENCE CHAIN</span>
        <b>正在汇集对象档案</b>
        <i aria-hidden="true" />
      </div>
    );
  }

  if (dossier.status === "error") {
    return (
      <div className="dial-archive-dossier-state is-error" role="alert">
        <span>DOSSIER REGISTER FAILURE</span>
        <b>对象档案未能完整建立</b>
        <p>{dossier.message ?? "无法读取当前对象的证据链。"}</p>
      </div>
    );
  }

  return (
    <div className="dial-archive-dossier-workcell">
      <i className="dial-archive-dossier-workcell__yellow-field" aria-hidden="true" />
      <i className="dial-archive-dossier-workcell__measure" aria-hidden="true" />
      <AnnotationDossierEvidence asset={asset} dossier={dossier} />
      <AnnotationDossierRegister asset={asset} dossier={dossier} />
    </div>
  );
}
