import { describe, expect, test } from "vitest";

import type { ArchiveProjectRecord } from "../../../../pages/spaces/spacePageModel";
import { formatProjectSerial, presentArchiveProject } from "./projectPresentation";

const project: ArchiveProjectRecord = {
  id: "project-1",
  name: "Portraits",
  rootPath: "D:\\portraits",
  exists: true,
  assetCount: 8742,
  annotatedCount: 7100,
  invalidCount: 0,
  createdAt: "2026-07-28T00:00:00Z",
  lastOpenedAt: "2026-07-30T00:00:00Z",
};

describe("dial archive project presentation", () => {
  test("uses actual workspace counters and active context", () => {
    expect(presentArchiveProject(project, project.id)).toMatchObject({
      state: "LOADED",
      stateKind: "loaded",
      assetCount: "8,742",
      annotatedCount: "7,100",
      invalidCount: "00",
    });
    expect(formatProjectSerial(3)).toBe("03");
  });

  test("reports missing and invalid workspaces as alerts", () => {
    expect(presentArchiveProject({ ...project, exists: false }, null).state).toBe("PATH MISSING");
    expect(presentArchiveProject({ ...project, invalidCount: 3 }, null).state).toBe("CHECK · 3");
  });
});
