import { apiRequest } from "../../shared/api/client";
import type {
  AnnotationBatchConfirmResult,
  AnnotationBatchDeleteResult,
  AnnotationBundle,
  AnnotationChannel,
  AnnotationDocument,
  AnnotationRevision,
  AnnotationTag,
} from "../../shared/api/types";

const annotationsPath = (projectId: string, assetId: string) =>
  `/api/v1/workspaces/${projectId}/assets/${assetId}/annotations`;

function channelPath(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
) {
  const query = language ? `?${new URLSearchParams({ language })}` : "";
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
): Promise<AnnotationDocument> {
  return apiRequest(channelPath(projectId, assetId, channel, language));
}

export function saveAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  input: {
    content?: string;
    tags?: AnnotationTag[];
    expectedHeadRevisionId: string | null;
    confirm?: boolean;
    language?: string;
  },
): Promise<AnnotationDocument> {
  return apiRequest(channelPath(projectId, assetId, channel, input.language), {
    method: "PUT",
    body: JSON.stringify({
      content: input.content,
      tags: input.tags,
      expected_head_revision_id: input.expectedHeadRevisionId,
      confirm: input.confirm,
    }),
  });
}

export function confirmAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  expectedHeadRevisionId: string,
  language = "",
): Promise<AnnotationDocument> {
  const base = channelPath(projectId, assetId, channel, language);
  const [path, query = ""] = base.split("?");
  return apiRequest(`${path}/confirm${query ? `?${query}` : ""}`, {
    method: "POST",
    body: JSON.stringify({ expected_head_revision_id: expectedHeadRevisionId }),
  });
}

export function deleteAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
): Promise<AnnotationDocument> {
  return apiRequest(channelPath(projectId, assetId, channel, language), { method: "DELETE" });
}

export function getAnnotationChannelHistory(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
): Promise<AnnotationRevision[]> {
  const base = channelPath(projectId, assetId, channel, language);
  const [path, query = ""] = base.split("?");
  return apiRequest(`${path}/history${query ? `?${query}` : ""}`);
}

export function deleteAnnotations(
  projectId: string,
  assetIds: string[],
): Promise<AnnotationBatchDeleteResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/delete`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds }),
  });
}

export function confirmTagAnnotations(
  projectId: string,
  assetIds: string[],
): Promise<AnnotationBatchConfirmResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/tags/confirm`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds }),
  });
}
