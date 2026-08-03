import { describe, expect, test } from "vitest";

import { getHomeSpace } from "../navigation/spaceRegistry";
import {
  buildFrontendHref,
  readInitialHomeSpaceId,
  readProjectId,
  replaceProjectIdInHref,
} from "./routeState";

describe("new frontend route state", () => {
  test("reads the home screenshot channel", () => {
    expect(readInitialHomeSpaceId("?s=1")).toBe("archive");
    expect(readInitialHomeSpaceId("?s=6")).toBe("capability");
    expect(readInitialHomeSpaceId("?s=99")).toBeUndefined();
  });

  test("accepts bounded route-safe project ids", () => {
    expect(readProjectId("?project=project-1")).toBe("project-1");
    expect(readProjectId("?project=019f8393-4409-7ff1-bae5-56f153f16ffb")).toBe(
      "019f8393-4409-7ff1-bae5-56f153f16ffb",
    );
    expect(readProjectId("?project=unsafe%2Fsegment")).toBeNull();
    expect(readProjectId("?project=..")).toBeNull();
    expect(readProjectId("?project=")).toBeNull();
  });

  test("builds stable theme links with project context", () => {
    expect(
      buildFrontendHref("/preparation", {
        themeId: "dial-archive",
        projectId: "project-1",
      }),
    ).toBe("/preparation?theme=dial-archive&project=project-1");
    expect(
      buildFrontendHref("/", {
        themeId: "dial-archive",
        projectId: "project-1",
        initialSpace: getHomeSpace("preparation"),
      }),
    ).toBe("/?theme=dial-archive&project=project-1&s=2");
  });

  test("replaces only the project query field", () => {
    expect(
      replaceProjectIdInHref(
        "/archive",
        "?theme=dial-archive&s=1&project=old-project",
        "new-project",
      ),
    ).toBe("/archive?theme=dial-archive&s=1&project=new-project");
    expect(
      replaceProjectIdInHref("/archive", "?theme=dial-archive&project=old-project", null),
    ).toBe("/archive?theme=dial-archive");
  });
});
