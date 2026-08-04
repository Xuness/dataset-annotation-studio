import type {
  AnnotationBundle,
  AnnotationChannel,
  AnnotationRevision,
  AssetAnnotationTrace,
  MetadataDocument,
  TranslationDocument,
} from "../../../../shared/api/types";
import type {
  AnnotationDossierDocument,
  AnnotationDossierMetadata,
  AnnotationDossierProvenance,
  AnnotationDossierRevision,
  AnnotationDossierTranslation,
} from "../spacePageModel";
import {
  annotationAvailabilityLabel,
  annotationRevisionSourceLabel,
  annotationTranslationStatusLabel,
} from "./annotationEditModel";

const CHANNEL_PRESENTATION: Readonly<
  Record<AnnotationChannel, { code: string; title: string; order: number }>
> = {
  existing_annotation: { code: "TXT.00", title: "原有标注", order: 0 },
  tags: { code: "TAG.01", title: "标签记录", order: 1 },
  description: { code: "DSC.02", title: "描述记录", order: 2 },
  translation: { code: "TRN.03", title: "翻译记录", order: 3 },
};

const AVAILABILITY = new Set(["missing", "usable", "stale", "invalid"]);

function availabilityLabel(value: string): string {
  return AVAILABILITY.has(value)
    ? annotationAvailabilityLabel(value as "missing" | "usable" | "stale" | "invalid")
    : value;
}

function compactText(value: string, limit = 240): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1)}…`;
}

export function stringifyDossierJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, null, 2) ?? null;
  } catch {
    return "[无法序列化的结构]";
  }
}

function metadataKind(value: unknown): string {
  if (value === null) return "NULL";
  if (Array.isArray(value)) return `LIST · ${value.length}`;
  if (typeof value === "object") return "OBJECT";
  return typeof value === "string" ? "TEXT" : typeof value === "number" ? "NUMBER" : "VALUE";
}

function metadataValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return compactText(value, 360);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return compactText(stringifyDossierJson(value) ?? "—", 360);
}

export function projectDossierMetadata(
  metadata: MetadataDocument | null | undefined,
): AnnotationDossierMetadata {
  if (!metadata) {
    return { exists: false, path: null, fields: [], raw: null, error: null };
  }

  const record =
    metadata.value && typeof metadata.value === "object" && !Array.isArray(metadata.value)
      ? (metadata.value as Record<string, unknown>)
      : null;
  const keys = metadata.fields?.length
    ? metadata.fields
    : record
      ? Object.keys(record)
      : metadata.value === undefined || metadata.value === null
        ? []
        : ["value"];

  return {
    exists: metadata.exists,
    path: metadata.path ?? null,
    fields: keys.map((key, index) => {
      const value = record ? record[key] : metadata.value;
      return {
        id: `${key}:${index}`,
        label: key,
        value: metadataValue(value),
        kind: metadataKind(value),
      };
    }),
    raw: stringifyDossierJson(metadata.value),
    error: metadata.error ?? null,
  };
}

export function projectDossierDocuments(
  bundle: AnnotationBundle | null | undefined,
): AnnotationDossierDocument[] {
  return [...(bundle?.documents ?? [])]
    .sort((left, right) => {
      const channelOrder =
        CHANNEL_PRESENTATION[left.channel].order - CHANNEL_PRESENTATION[right.channel].order;
      if (channelOrder !== 0) return channelOrder;
      return (left.language ?? "").localeCompare(right.language ?? "");
    })
    .map((document, index) => {
      const presentation = CHANNEL_PRESENTATION[document.channel];
      return {
        id:
          document.document_id ??
          `${document.channel}:${document.language ?? "default"}:${index.toString()}`,
        code: presentation.code,
        title: document.language
          ? `${presentation.title} · ${document.language}`
          : presentation.title,
        status: document.status,
        statusLabel: availabilityLabel(document.availability_status),
        availability: document.availability_status,
        language: document.language ?? null,
        source: document.source ? annotationRevisionSourceLabel(document.source) : null,
        reviewStatus: document.review_status ?? null,
        updatedAt: document.updated_at ?? document.modified_at ?? null,
        revisionId: document.head_revision_id ?? null,
        imageHash: document.image_content_hash ?? null,
        validationMessage: document.validation?.issues[0]?.message ?? null,
      };
    });
}

export interface AnnotationDossierHistorySource {
  channel: Exclude<AnnotationChannel, "translation">;
  revisions: readonly AnnotationRevision[] | undefined;
}

function revisionPreview(revision: AnnotationRevision): string {
  if (revision.is_tombstone) return "记录已删除";
  if (revision.tags?.length) {
    const visible = revision.tags.slice(0, 8).map((tag) => tag.name);
    return `${visible.join(" · ")}${revision.tags.length > visible.length ? " · …" : ""}`;
  }
  return compactText(revision.content, 180) || "空白修订";
}

export function projectDossierRevisions(
  sources: readonly AnnotationDossierHistorySource[],
): AnnotationDossierRevision[] {
  return sources
    .flatMap(({ channel, revisions }) =>
      (revisions ?? []).map((revision) => {
        const resolvedChannel = revision.channel ?? channel;
        const presentation = CHANNEL_PRESENTATION[resolvedChannel];
        return {
          id: revision.id,
          channel: resolvedChannel,
          channelLabel: presentation.title,
          source: annotationRevisionSourceLabel(revision.source),
          createdAt: revision.created_at,
          preview: revisionPreview(revision),
          candidate: revision.is_candidate,
          tombstone: revision.is_tombstone,
          validationStatus: revision.validation_status,
          jobItemId: revision.source_job_item_id ?? null,
          imageHash: revision.image_content_hash ?? null,
        };
      }),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function projectDossierTranslations(
  translations: readonly TranslationDocument[] | null | undefined,
): AnnotationDossierTranslation[] {
  return [...(translations ?? [])]
    .sort((left, right) => {
      const languageOrder = left.language.localeCompare(right.language);
      if (languageOrder !== 0) return languageOrder;
      const sourceOrder = left.source_kind.localeCompare(right.source_kind);
      if (sourceOrder !== 0) return sourceOrder;
      return left.producer_kind.localeCompare(right.producer_kind);
    })
    .map((translation) => ({
      id: `${translation.language}:${translation.source_kind}:${translation.producer_kind}`,
      language: translation.language,
      sourceKind: translation.source_kind,
      producerKind: translation.producer_kind,
      status: translation.status,
      statusLabel: annotationTranslationStatusLabel(translation.status),
      producer: translation.producer_kind === "local_dictionary" ? "本地词典" : "语言模型",
      model: translation.model ?? null,
      provider: translation.provider_profile_name ?? translation.provider_profile_id ?? null,
      updatedAt: translation.updated_at ?? translation.modified_at ?? null,
      sourceRevisionId: translation.source_revision_id ?? null,
      sourceHash: translation.source_hash ?? null,
      currentSourceHash: translation.current_source_hash ?? null,
      qualityStatus: translation.quality_status,
      alignmentStatus: translation.alignment_status,
      issue: translation.issue ?? null,
      qualityIssues: translation.quality_issues ?? [],
    }));
}

export function projectDossierProvenance(
  trace: AssetAnnotationTrace | null | undefined,
): AnnotationDossierProvenance | null {
  if (!trace) return null;
  const parameters = trace.request.parameters;
  const tokenTotal =
    (trace.response.input_tokens ?? 0) +
    (trace.response.output_tokens ?? 0) +
    (trace.response.reasoning_tokens ?? 0);
  return {
    source: trace.annotation_source ?? null,
    current: trace.matches_current_annotation,
    readings: [
      { id: "job", label: "JOB", value: trace.job_id, detail: trace.job_status },
      { id: "item", label: "ITEM", value: trace.item_id, detail: trace.item_status },
      {
        id: "attempt",
        label: "ATTEMPT",
        value: trace.attempt_id,
        detail: `${trace.attempt_number.toString().padStart(2, "0")} / ${trace.attempt_status}`,
      },
      {
        id: "model",
        label: "MODEL",
        value: parameters.model || "—",
        detail: parameters.execution_backend,
      },
      {
        id: "provider",
        label: "PROVIDER",
        value: parameters.provider_profile_name || "—",
        detail: parameters.provider_type,
      },
      { id: "started", label: "STARTED", value: trace.started_at },
      { id: "finished", label: "FINISHED", value: trace.finished_at ?? "—" },
      {
        id: "tokens",
        label: "TOKENS",
        value: tokenTotal > 0 ? tokenTotal.toLocaleString() : "—",
        detail: trace.response.finish_reason ?? undefined,
        tone: trace.response.error_message ? "attention" : "default",
      },
    ],
    requestJson: stringifyDossierJson(trace.request) ?? "{}",
    responseJson: stringifyDossierJson(trace.response) ?? "{}",
  };
}
