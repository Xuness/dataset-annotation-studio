import { describe, expect, test } from "vitest";

import type { AnnotationStageAsset } from "../spacePageModel";
import {
  isAnnotationWorkcellId,
  resolveStageFocus,
  resolveStageRangeToggle,
  shouldContinueStageAssetSearch,
  stepStageIndex,
  toAnnotationStageAsset,
} from "./annotationStageModel";

function stageAsset(id: string): AnnotationStageAsset {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `images/${id}.png`,
    width: 1024,
    height: 1024,
    byteSize: 2048,
    suffix: ".png",
    imageUrl: `/image/${id}`,
    thumbnailUrl: `/thumbnail/${id}`,
    annotationStatus: "valid",
    channelStatuses: {},
  };
}

describe("annotation stage model", () => {
  test("recognizes only the three stable workcell identities", () => {
    expect(isAnnotationWorkcellId("edit")).toBe(true);
    expect(isAnnotationWorkcellId("production")).toBe(true);
    expect(isAnnotationWorkcellId("dossier")).toBe(true);
    expect(isAnnotationWorkcellId("preview")).toBe(false);
    expect(isAnnotationWorkcellId(null)).toBe(false);
  });

  test("projects asset summaries with byte size and suffix evidence", () => {
    const projected = toAnnotationStageAsset(
      {
        id: "asset-1",
        filename: "portrait.png",
        relative_path: "images/portrait.png",
        annotation_relative_path: "annotations/portrait.json",
        metadata_relative_path: null,
        width: 1536,
        height: 2048,
        byte_size: 4_194_304,
        suffix: ".png",
        content_version: "v1",
        annotation_status: "valid",
        annotation_channels: { tags: "valid" },
        generation_error: null,
        generation_status: null,
      },
      "/image/asset-1",
      "/thumbnail/asset-1",
    );
    expect(projected.byteSize).toBe(4_194_304);
    expect(projected.suffix).toBe(".png");
    expect(projected.channelStatuses.tags).toBe("valid");
  });

  test("keeps focus on the requested stable asset id", () => {
    const assets = [stageAsset("a"), stageAsset("b"), stageAsset("c")];
    const focus = resolveStageFocus(assets, "b", 0);
    expect(focus.asset?.id).toBe("b");
    expect(focus.index).toBe(1);
  });

  test("keeps an unloaded requested id unresolved instead of showing the wrong asset", () => {
    const assets = [stageAsset("a"), stageAsset("b"), stageAsset("c")];
    const focus = resolveStageFocus(assets, "missing", 2);
    expect(focus.asset).toBe(null);
    expect(focus.index).toBe(-1);
  });

  test("continues deep-link pagination only while the target can still be resolved", () => {
    const base = {
      requestedAssetId: "target",
      loadedAssetIds: ["a", "b"],
      hasMore: true,
      fetchingMore: false,
      loadFailed: false,
    };
    expect(shouldContinueStageAssetSearch(base)).toBe(true);
    expect(shouldContinueStageAssetSearch({ ...base, loadedAssetIds: ["a", "target"] })).toBe(
      false,
    );
    expect(shouldContinueStageAssetSearch({ ...base, fetchingMore: true })).toBe(false);
    expect(shouldContinueStageAssetSearch({ ...base, loadFailed: true })).toBe(false);
    expect(shouldContinueStageAssetSearch({ ...base, hasMore: false })).toBe(false);
  });

  test("clamps the held position to the loaded window", () => {
    const assets = [stageAsset("a"), stageAsset("b")];
    const focus = resolveStageFocus(assets, null, 6);
    expect(focus.asset?.id).toBe("b");
    expect(focus.index).toBe(1);
  });

  test("reports an empty sequence without inventing a focus", () => {
    const focus = resolveStageFocus([], "a", 0);
    expect(focus.asset).toBe(null);
    expect(focus.index).toBe(-1);
  });

  test("steps within bounds and clamps at both rails", () => {
    const assets = [stageAsset("a"), stageAsset("b"), stageAsset("c")];
    expect(stepStageIndex(assets, 0, 1)?.id).toBe("b");
    expect(stepStageIndex(assets, 2, 1)?.id).toBe("c");
    expect(stepStageIndex(assets, 0, -1)?.id).toBe("a");
    expect(stepStageIndex(assets, -1, 1)?.id).toBe("b");
    expect(stepStageIndex([], 0, 1)).toBe(null);
  });

  test("makes a repeated shift range reversible from the target state", () => {
    const assetIds = ["a", "b", "c", "d"];
    expect(resolveStageRangeToggle(assetIds, "b", "d", [])).toEqual({
      assetIds: ["b", "c", "d"],
      checked: true,
    });
    expect(resolveStageRangeToggle(assetIds, "b", "d", ["b", "c", "d"])).toEqual({
      assetIds: ["b", "c", "d"],
      checked: false,
    });
    expect(resolveStageRangeToggle(assetIds, "missing", "c", ["c"])).toEqual({
      assetIds: ["c"],
      checked: false,
    });
  });
});
