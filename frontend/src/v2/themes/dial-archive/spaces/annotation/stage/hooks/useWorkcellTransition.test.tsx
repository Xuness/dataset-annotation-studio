import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AnnotationWorkcellId } from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT } from "../model/annotationStageLayout";
import { useWorkcellTransition } from "./useWorkcellTransition";

describe("annotation workcell transition", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("lets the latest workcell intent interrupt an unfinished opening", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ active }: { active: AnnotationWorkcellId | null }) => useWorkcellTransition(active, false),
      { initialProps: { active: null as AnnotationWorkcellId | null } },
    );
    expect(result.current.phase).toBe("overview");

    rerender({ active: "edit" });
    expect(result.current).toMatchObject({ phase: "opening", displayedWorkcell: "edit" });

    rerender({ active: "production" });
    expect(result.current).toMatchObject({
      phase: "switching",
      displayedWorkcell: "production",
      departingWorkcell: "edit",
    });

    act(() => {
      vi.advanceTimersByTime(ANNOTATION_STAGE_LAYOUT.motion.workcellSwitchDurationMs);
    });
    expect(result.current).toMatchObject({
      phase: "active",
      displayedWorkcell: "production",
      departingWorkcell: null,
    });

    rerender({ active: null });
    expect(result.current).toMatchObject({ phase: "closing", displayedWorkcell: "production" });
    act(() => {
      vi.advanceTimersByTime(ANNOTATION_STAGE_LAYOUT.motion.workcellCloseDurationMs);
    });
    expect(result.current).toMatchObject({ phase: "overview", displayedWorkcell: null });
  });

  test("presents the route state immediately when motion is reduced", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: AnnotationWorkcellId | null }) => useWorkcellTransition(active, true),
      { initialProps: { active: "edit" as AnnotationWorkcellId | null } },
    );
    expect(result.current).toMatchObject({ phase: "active", displayedWorkcell: "edit" });

    rerender({ active: null });
    expect(result.current).toMatchObject({ phase: "overview", displayedWorkcell: null });
  });
});
