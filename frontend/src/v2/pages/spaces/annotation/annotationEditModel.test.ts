import { describe, expect, test } from "vitest";

import {
  isAnnotationEditChannelId,
  projectAnnotationEditChannels,
  projectAnnotationTagGroups,
} from "./annotationEditModel";

describe("annotation edit model", () => {
  test("recognizes the four stable edit document identities", () => {
    expect(isAnnotationEditChannelId("existing_annotation")).toBe(true);
    expect(isAnnotationEditChannelId("tags")).toBe(true);
    expect(isAnnotationEditChannelId("description")).toBe(true);
    expect(isAnnotationEditChannelId("translation")).toBe(true);
    expect(isAnnotationEditChannelId("production")).toBe(false);
  });

  test("keeps imported text visible but unavailable when the asset has no source document", () => {
    const channels = projectAnnotationEditChannels(
      (channel) => (channel === "tags" ? "reviewed" : undefined),
      "zh-CN",
      false,
    );
    expect(channels).toHaveLength(4);
    expect(channels[0]).toMatchObject({
      id: "existing_annotation",
      enabled: false,
      state: "missing",
    });
    expect(channels[1]).toMatchObject({ id: "tags", state: "reviewed" });
  });

  test("projects tag lanes without losing confidence and origin evidence", () => {
    const groups = projectAnnotationTagGroups(
      [
        {
          category: "character",
          items: [
            {
              key: "amiya",
              tag: {
                name: "amiya",
                category: "character",
                confidence: 0.97,
                origin: "local_tagger",
              },
            },
          ],
        },
      ],
      "amiya",
      null,
    );
    expect(groups[0]).toMatchObject({ label: "角色", tone: "accent" });
    expect(groups[0].items[0]).toMatchObject({
      name: "amiya",
      confidence: 0.97,
      origin: "local_tagger",
      highlighted: true,
    });
  });
});
