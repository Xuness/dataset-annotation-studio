import { useMemo, useState } from "react";

import { useAnnotationTraceHistory, useAssetMetadata } from "../../../../features/assets/hooks";
import {
  useAnnotationBundle,
  useAnnotationChannelHistory,
} from "../../../../features/annotations/hooks";
import { useTranslations } from "../../../../features/translations/hooks";
import { useAssetJobs } from "../../../../features/jobs/hooks";
import type { AnnotationDossierContent } from "../spacePageModel";
import {
  projectDossierDocuments,
  projectDossierMetadata,
  projectDossierJobs,
  projectDossierProvenanceHistory,
  projectDossierRevisions,
  projectDossierTranslations,
} from "./annotationDossierModel";

interface UseAnnotationDossierControllerOptions {
  projectId: string;
  assetId: string | null;
  enabled: boolean;
  onOpenJob(jobId: string): void;
  onOpenArchive(): void;
  onOpenQuality(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useAnnotationDossierController({
  projectId,
  assetId,
  enabled,
  onOpenJob,
  onOpenArchive,
  onOpenQuality,
}: UseAnnotationDossierControllerOptions): AnnotationDossierContent {
  const [provenanceSelection, setProvenanceSelection] = useState<{
    assetId: string;
    traceId: string;
  } | null>(null);
  const active = Boolean(enabled && projectId && assetId);
  const bundle = useAnnotationBundle(projectId, assetId, active);
  const metadata = useAssetMetadata(projectId, assetId, active);
  const translations = useTranslations(projectId, assetId, active);
  const traces = useAnnotationTraceHistory(projectId, assetId, active);
  const jobs = useAssetJobs(projectId, assetId, active);
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

  const criticalQueries = [
    bundle,
    metadata,
    translations,
    existingHistory,
    tagsHistory,
    descriptionHistory,
  ] as const;
  const loading = active && criticalQueries.some((query) => query.isPending);
  const failed = active && criticalQueries.some((query) => query.isError);
  const firstError = criticalQueries.find((query) => query.isError)?.error;

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
  const provenanceHistory = useMemo(
    () => projectDossierProvenanceHistory(traces.data),
    [traces.data],
  );
  const selectedProvenanceId =
    provenanceSelection?.assetId === assetId ? provenanceSelection.traceId : null;
  const provenance =
    provenanceHistory.find((record) => record.id === selectedProvenanceId) ??
    provenanceHistory.find((record) => record.current && record.executionBackend === "provider") ??
    provenanceHistory.find((record) => record.current) ??
    provenanceHistory[0] ??
    null;
  const jobRecords = useMemo(() => projectDossierJobs(jobs.data), [jobs.data]);

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
    provenanceHistory,
    selectedProvenanceId: provenance?.id ?? null,
    provenanceLoading: active && traces.isPending,
    provenanceIssue: traces.isError
      ? describeError(traces.error, "无法读取当前对象的生成溯源。")
      : null,
    jobs: jobRecords,
    jobsLoading: active && jobs.isPending,
    jobsIssue: jobs.isError ? describeError(jobs.error, "无法读取当前对象的关联任务。") : null,
    selectProvenance: (traceId) => {
      if (!assetId) return;
      setProvenanceSelection({ assetId, traceId });
    },
    openJob: onOpenJob,
    openArchive: onOpenArchive,
    openQuality: onOpenQuality,
  };
}
