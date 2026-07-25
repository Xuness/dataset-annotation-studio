import { apiRequest } from "../../shared/api/client";
import type {
  AnnotationBatchDeleteResult,
  AnnotationBatchOptions,
  AnnotationBatchReviewResult,
  AnnotationBundle,
  AnnotationChannel,
  AnnotationChannelTarget,
  AnnotationDocument,
  AnnotationRevision,
  AnnotationTag,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";

const annotationsPath = (projectId: string, assetId: string) =>
  `/api/v1/workspaces/${projectId}/assets/${assetId}/annotations`;

function channelPath(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
) {
  const parameters = new URLSearchParams();
  if (language) {
    parameters.set("language", language);
  }
  if (channel === "translation") {
    parameters.set("translation_source_kind", translationSourceKind);
    parameters.set("translation_producer_kind", translationProducerKind);
  }
  const query = parameters.size ? `?${parameters}` : "";
  return `${annotationsPath(projectId, assetId)}/${channel}${query}`;
}

export function getAnnotationBundle(projectId: string, assetId: string): Promise<AnnotationBundle> {
  return apiRequest(annotationsPath(projectId, assetId));
}

export function getAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
): Promise<AnnotationDocument> {
  return apiRequest(
    channelPath(
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ),
  );
}

export function saveAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  input: {
    content?: string;
    tags?: AnnotationTag[];
    expectedHeadRevisionId: string | null;
    review?: boolean;
    language?: string;
    translationSourceKind?: TranslationSourceKind;
    translationProducerKind?: TranslationProducerKind;
  },
): Promise<AnnotationDocument> {
  return apiRequest(
    channelPath(
      projectId,
      assetId,
      channel,
      input.language,
      input.translationSourceKind,
      input.translationProducerKind,
    ),
    {
      method: "PUT",
      body: JSON.stringify({
        content: input.content,
        tags: input.tags,
        expected_head_revision_id: input.expectedHeadRevisionId,
        review: input.review,
      }),
    },
  );
}

export function reviewAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  expectedHeadRevisionId: string,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
): Promise<AnnotationDocument> {
  const base = channelPath(
    projectId,
    assetId,
    channel,
    language,
    translationSourceKind,
    translationProducerKind,
  );
  const [path, query = ""] = base.split("?");
  return apiRequest(`${path}/review${query ? `?${query}` : ""}`, {
    method: "POST",
    body: JSON.stringify({ expected_head_revision_id: expectedHeadRevisionId }),
  });
}

export function deleteAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
): Promise<AnnotationDocument> {
  return apiRequest(
    channelPath(
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ),
    { method: "DELETE" },
  );
}

export function getAnnotationChannelHistory(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
): Promise<AnnotationRevision[]> {
  const base = channelPath(
    projectId,
    assetId,
    channel,
    language,
    translationSourceKind,
    translationProducerKind,
  );
  const [path, query = ""] = base.split("?");
  return apiRequest(`${path}/history${query ? `?${query}` : ""}`);
}

export function deleteAnnotations(
  projectId: string,
  assetIds: string[],
  targets: AnnotationChannelTarget[],
): Promise<AnnotationBatchDeleteResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/delete`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds, targets }),
  });
}

export function getAnnotationBatchOptions(
  projectId: string,
  assetIds: string[],
): Promise<AnnotationBatchOptions> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/options`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds }),
  });
}

export function reviewAnnotations(
  projectId: string,
  assetIds: string[],
  targets: AnnotationChannelTarget[],
): Promise<AnnotationBatchReviewResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/review`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds, targets }),
  });
}
