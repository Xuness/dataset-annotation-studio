import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  useAlignedTranslationScroll,
  type TranslationAlignmentSide,
} from "./useAlignedTranslationScroll";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function rectangle(top: number, height: number, width = 320): DOMRect {
  return {
    x: 0,
    y: top,
    width,
    height,
    top,
    right: width,
    bottom: top + height,
    left: 0,
    toJSON: () => ({}),
  };
}

function mockScrollablePane(pane: HTMLElement, scrollHeight: number, segmentCenters: number[]) {
  Object.defineProperties(pane, {
    clientWidth: { configurable: true, value: 320 },
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
  vi.spyOn(pane, "getBoundingClientRect").mockImplementation(() => rectangle(0, 100));
  const segments = pane.querySelectorAll<HTMLElement>("[data-alignment-id]");
  expect(segments.length).toBe(segmentCenters.length);
  segments.forEach((segment, index) => {
    vi.spyOn(segment, "getBoundingClientRect").mockImplementation(() =>
      rectangle(segmentCenters[index] - pane.scrollTop - 10, 20),
    );
  });
}

function mockAnimationFrames() {
  let nextFrameId = 1;
  let timestamp = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    frames.set(frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
    frames.delete(frameId);
  });
  return {
    runNext(elapsed: number) {
      timestamp += elapsed;
      const frame = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      expect(frame).toBeDefined();
      frames.delete(frame![0]);
      frame![1](timestamp);
    },
  };
}

function TranslationScrollHarness() {
  const sourceRootRef = useRef<HTMLElement>(null);
  const targetRootRef = useRef<HTMLElement>(null);
  const [alignmentIds, setAlignmentIds] = useState<string[]>([]);
  const activateSide = useAlignedTranslationScroll({
    sourceRootRef,
    targetRootRef,
    alignmentIds,
    layoutKey: "two-segment-layout",
    enabled: true,
  });

  const renderPane = (side: TranslationAlignmentSide) => (
    <section ref={side === "source" ? sourceRootRef : targetRootRef}>
      <div
        className="dial-archive-edit-translation__aligned is-segment"
        data-testid={`${side}-pane`}
      >
        {["segment-0", "segment-1"].map((id) => (
          <span
            data-alignment-id={id}
            onPointerEnter={() => {
              activateSide(side);
              setAlignmentIds([id]);
            }}
            key={`${side}:${id}`}
          >
            {`${side}:${id}`}
          </span>
        ))}
      </div>
    </section>
  );

  return (
    <div>
      {renderPane("source")}
      {renderPane("target")}
    </div>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () =>
      ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
});

describe("V2 aligned translation scrolling", () => {
  test("synchronizes both directions through matching alignment anchors", () => {
    render(<TranslationScrollHarness />);
    const source = screen.getByTestId("source-pane");
    const target = screen.getByTestId("target-pane");
    mockScrollablePane(source, 500, [50, 250]);
    mockScrollablePane(target, 900, [80, 400]);

    source.scrollTop = 215;
    fireEvent.scroll(source);
    expect(target.scrollTop).toBeCloseTo(365);

    fireEvent.scroll(target);
    source.scrollTop = 0;
    target.scrollTop = 365;
    fireEvent.scroll(target);
    expect(source.scrollTop).toBeCloseTo(215);
  });

  test("reveals the off-screen counterpart without feeding the scroll back", () => {
    render(<TranslationScrollHarness />);
    const animationFrames = mockAnimationFrames();
    const source = screen.getByTestId("source-pane");
    const target = screen.getByTestId("target-pane");
    mockScrollablePane(source, 500, [50, 250]);
    mockScrollablePane(target, 900, [80, 400]);
    const selectedTarget = screen.getByText("target:segment-1");

    target.scrollTop = 365;
    fireEvent.pointerEnter(selectedTarget);

    expect(source.scrollTop).toBe(0);
    animationFrames.runNext(0);
    animationFrames.runNext(80);
    expect(source.scrollTop).toBeGreaterThan(0);
    expect(source.scrollTop).toBeLessThan(168);
    animationFrames.runNext(80);
    expect(source.scrollTop).toBeCloseTo(168);

    fireEvent.scroll(source);
    expect(target.scrollTop).toBeCloseTo(365);
  });
});
