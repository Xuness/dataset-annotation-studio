import { afterEach, describe, expect, test, vi } from "vitest";

import { apiRequest, formatApiErrorDetail } from "../../../src/shared/api/client";

afterEach(() => vi.unstubAllGlobals());

describe("API error details", () => {
  test("formats FastAPI validation issues without object coercion", async () => {
    const detail = [
      {
        type: "extra_forbidden",
        loc: ["body", "directory_layout"],
        msg: "Extra inputs are not permitted",
        input: { mode: "custom" },
      },
    ];
    expect(formatApiErrorDetail(detail)).toBe("directory_layout：当前后端不支持此字段");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(apiRequest("/api/v1/test")).rejects.toMatchObject({
      status: 422,
      message: "directory_layout：当前后端不支持此字段",
    });
  });

  test("keeps string details and safely serializes unknown objects", () => {
    expect(formatApiErrorDetail("目标目录必须为空。")).toBe("目标目录必须为空。");
    expect(formatApiErrorDetail({ code: "conflict", count: 2 })).toBe(
      '{"code":"conflict","count":2}',
    );
  });
});
