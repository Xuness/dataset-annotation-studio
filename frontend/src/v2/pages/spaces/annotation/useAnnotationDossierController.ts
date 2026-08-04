import { useMemo } from "react";

import { useAnnotationTrace, useAssetMetadata } from "../../../../features/assets/hooks";
import {
  useAnnotationBundle,
  useAnnotationChannelHistory,
} from "../../../../features/annotations/hooks";
import { useTranslations } from "../../../../features/translations/hooks";
import type { AnnotationDossierContent } from "../spacePageModel";
import {
  projectDossierDocuments,
  projectDossierMetadata,
  projectDossierProvenance,
  projectDossierRevisions,
  projectDossierTranslations,
} from "./annotationDossierModel";

interface UseAnnotationDossierControllerOptions {
  projectId: string;
  assetId: string | null;
  enabled: boolean;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useAnnotationDossierController({
  projectId,
  assetId,
  enabled,
}: UseAnnotationDossierControllerOptions): AnnotationDossierContent {
  const active = Boolean(enabled && projectId && assetId);
  const bundle = useAnnotationBundle(projectId, assetId, active);
  const metadata = useAssetMetadata(projectId, assetId, active);
  const translations = useTranslations(projectId, assetId, active);
  const trace = useAnnotationTrace(projectId, assetId, active);
  const existingHistory = useAnnotationChannelHistory(
    projectId,
    assetId,
    "existing_annotation",
    "",
    active,
  );
  const tagsHistory = useAnnotationChannelHistory(projectId, assetId, "tags", "", active);
  const descriptionHistory = useAnnotationChannelHistory(
    projectId,
    assetId,
    "description",
    "",
    active,
  );

  const queries = [
    bundle,
    metadata,
    translations,
    trace,
    existingHistory,
    tagsHistory,
    descriptionHistory,
  ] as const;
  const loading = active && queries.some((query) => query.isPending);
  const failed = active && queries.some((query) => query.isError);
  const firstError = queries.find((query) => query.isError)?.error;

  const documents = useMemo(() => projectDossierDocuments(bundle.data), [bundle.data]);
  const metadataRecord = useMemo(() => projectDossierMetadata(metadata.data), [metadata.data]);
  const revisions = useMemo(
    () =>
      projectDossierRevisions([
        { channel: "existing_annotation", revisions: existingHistory.data },
        { channel: "tags", revisions: tagsHistory.data },
        { channel: "description", revisions: descriptionHistory.data },
      ]),
    [descriptionHistory.data, existingHistory.data, tagsHistory.data],
  );
  const translationRecords = useMemo(
    () => projectDossierTranslations(translations.data),
    [translations.data],
  );
  const provenance = useMemo(() => projectDossierProvenance(trace.data), [trace.data]);

  return {
    status: !enabled
      ? "inactive"
      : !assetId
        ? "no-object"
        : loading
          ? "loading"
          : failed
            ? "error"
            : "ready",
    message: failed ? describeError(firstError, "无法建立当前对象的完整档案链。") : null,
    documents,
    metadata: metadataRecord,
    revisions,
    translations: translationRecords,
    provenance,
  };
}
