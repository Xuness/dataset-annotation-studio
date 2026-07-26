import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { writeClipboardText } from "../../src/shared/desktop/writeClipboardText";
import { useClipboardHistoryBridge } from "../../src/shared/desktop/useClipboardHistoryBridge";

function ClipboardHistoryBridgeHarness({ preventShortcut = false }: { preventShortcut?: boolean }) {
  useClipboardHistoryBridge();
  return (
    <div
      data-testid="selection"
      onKeyDown={preventShortcut ? (event) => event.preventDefault() : undefined}
      tabIndex={0}
    >
      <span>complete source selection</span>
    </div>
  );
}

describe("cross-platform clipboard writes", () => {
  const webviewWrite = vi.fn(async () => undefined);

  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
    webviewWrite.mockClear();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: webviewWrite },
    });
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    cleanup();
    vi.useRealTimers();
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

  test("writes a shortcut selection when WebView2 omits the copy event", async () => {
    vi.useFakeTimers();
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(true);
    render(<ClipboardHistoryBridgeHarness />);
    const selected = screen.getByTestId("selection");
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(selected, { key: "c", ctrlKey: true });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("write_clipboard_text_with_history", {
      text: "complete source selection",
    });
  });

  test("does not duplicate a shortcut selection when the copy event arrives", async () => {
    vi.useFakeTimers();
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(true);
    render(<ClipboardHistoryBridgeHarness />);
    const selected = screen.getByTestId("selection");
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(selected, { key: "c", ctrlKey: true });
    fireEvent.copy(selected);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("write_clipboard_text_with_history", {
      text: "complete source selection",
    });
  });

  test("does not bypass a component that deliberately blocks the shortcut", async () => {
    vi.useFakeTimers();
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(true);
    render(<ClipboardHistoryBridgeHarness preventShortcut />);
    const selected = screen.getByTestId("selection");
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(selected, { key: "c", ctrlKey: true });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
