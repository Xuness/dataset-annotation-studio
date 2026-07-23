import { beforeEach, describe, expect, test, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { writeClipboardText } from "../../src/shared/desktop/writeClipboardText";

describe("cross-platform clipboard writes", () => {
  const webviewWrite = vi.fn(async () => undefined);

  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
    webviewWrite.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: webviewWrite },
    });
  });

  test("keeps the native Windows clipboard-history result when available", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(true);

    await writeClipboardText("native");

    expect(tauri.invoke).toHaveBeenCalledWith("write_clipboard_text_with_history", {
      text: "native",
    });
    expect(webviewWrite).not.toHaveBeenCalled();
  });

  test("falls back to the WebView when the native bridge is unsupported", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(false);

    await writeClipboardText("portable");

    expect(webviewWrite).toHaveBeenCalledWith("portable");
  });

  test("falls back to the WebView when the native bridge raises an error", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockRejectedValue(new Error("clipboard unavailable"));

    await writeClipboardText("fallback");

    expect(webviewWrite).toHaveBeenCalledWith("fallback");
  });
});
