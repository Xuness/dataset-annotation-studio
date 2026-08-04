import { describe, expect, test } from "vitest";

import type { AnnotationStageAsset } from "../../../../../../pages/spaces/spacePageModel";
import {
  describeWorkcellStatus,
  readAssetChannelStates,
  selectStageEvidenceAssets,
} from "./annotationStagePresentation";

function evidenceAsset(id: string): AnnotationStageAsset {
  return { id } as AnnotationStageAsset;
}

describe("annotation stage presentation", () => {
  test("compresses backend review states into readable instrument codes", () => {
    const asset = {
      id: "a",
      channelStatuses: {
        tags: "reviewed",
        description: "unreviewed",
        translation: "missing",
      },
    } as unknown as AnnotationStageAsset;

    expect(readAssetChannelStates(asset).map((reading) => reading.stateCode)).toEqual([
      "REV",
      "NEW",
      "—",
    ]);
    expect(describeWorkcellStatus("edit", asset, 0, 1, [], null).label).toBe("通道 2/3 有效");
  });

  test("uses ranged assets before neighboring assets without repeating the current object", () => {
    const assets = ["a", "b", "c", "d", "e"].map(evidenceAsset);

    const selected = selectStageEvidenceAssets(assets, 2, ["c", "e"], 3);

    expect(selected.map((asset) => asset.id)).toEqual(["e", "b", "d"]);
  });

  test("fills the evidence field near sequence boundaries", () => {
    const assets = ["a", "b", "c", "d"].map(evidenceAsset);

    const selected = selectStageEvidenceAssets(assets, 0, [], 3);

    expect(selected.map((asset) => asset.id)).toEqual(["b", "c", "d"]);
  });
});
