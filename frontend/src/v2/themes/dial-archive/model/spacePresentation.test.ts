import { describe, expect, test } from "vitest";

import { HOME_SPACES } from "../../../navigation/spaceRegistry";
import { DIAL_ARCHIVE_SPACES, getDialArchiveSpace } from "./spacePresentation";

describe("dial archive presentation registry", () => {
  test("decorates the shared space objects instead of duplicating their semantics", () => {
    expect(DIAL_ARCHIVE_SPACES.map((space) => space.id)).toEqual(
      HOME_SPACES.map((space) => space.id),
    );
    expect(DIAL_ARCHIVE_SPACES.map((space) => space.label)).toEqual(
      HOME_SPACES.map((space) => space.label),
    );
    expect(new Set(DIAL_ARCHIVE_SPACES.map((space) => space.code)).size).toBe(6);
    expect(getDialArchiveSpace("quality").code).toBe("QAC");
  });
});
