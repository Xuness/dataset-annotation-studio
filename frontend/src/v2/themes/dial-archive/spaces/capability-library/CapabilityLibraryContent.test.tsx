import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CapabilityLibraryCategory,
  CapabilityLibraryCategoryId,
  CapabilityLibraryContent as CapabilityLibraryContentModel,
} from "../../../../pages/spaces/spacePageModel";
import { CapabilityLibraryContent } from "./CapabilityLibraryContent";

afterEach(cleanup);

function category(
  id: CapabilityLibraryCategoryId,
  index: string,
  code: string,
  label: string,
  englishLabel: string,
  lane: "primary" | "system",
): CapabilityLibraryCategory {
  const defaultGroupId =
    id === "providers"
      ? "connections"
      : id === "taggers"
        ? "profiles"
        : id === "dictionaries"
          ? "installations"
          : id === "prompts"
            ? "system"
            : "appearance";
  return {
    id,
    index,
    code,
    label,
    englishLabel,
    lane,
    description: `${label}能力摘要`,
    state: "ready",
    stateLabel: "ONLINE",
    headlineValue: "00",
    headlineLabel: "REGISTERED RESOURCES",
    summary: `${label}能力索引已就绪。`,
    notice: null,
    metrics: [{ id: "count", label: "COUNT", value: "00" }],
    groups: [
      {
        id: defaultGroupId,
        code: "REG",
        label: "资源分区",
        englishLabel: "Resource Lane",
        description: "分类内资源分区。",
        count: 0,
      },
    ],
    defaultGroupId,
    inventory: [],
  };
}

function renderCapabilityLibrary() {
  const refresh = vi.fn();
  const openCategory = vi.fn();
  const content: CapabilityLibraryContentModel = {
    kind: "capability-library",
    status: "ready",
    message: null,
    categories: [
      category("providers", "01", "PVD", "模型连接", "Provider Gateway", "primary"),
      category("taggers", "02", "TAG", "本地打标", "Local Taggers", "primary"),
      category("dictionaries", "03", "DIC", "Tag 词典", "Tag Dictionaries", "primary"),
      category("prompts", "04", "PRM", "Prompt 协议", "Prompt Protocols", "primary"),
      category("system", "S1", "SYS", "Studio 控制", "Studio Control", "system"),
    ],
    openCategory,
    refresh,
  };
  render(<CapabilityLibraryContent content={content} />);
  return { openCategory, refresh };
}

describe("classic capability library overview", () => {
  test("defaults to PVD and switches categories with the vertical tab keyboard model", () => {
    renderCapabilityLibrary();
    const providers = screen.getByRole("tab", { name: /PVD/u });
    const taggers = screen.getByRole("tab", { name: /TAG/u });

    expect(providers.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(providers, { key: "ArrowDown" });

    expect(taggers.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(taggers);
    expect(screen.getByRole("heading", { name: "本地打标" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "TAG 本地打标技术构件" })).toBeTruthy();
  });

  test("separates SYS from production categories and opens its level-three register", () => {
    const { openCategory } = renderCapabilityLibrary();
    const system = screen.getByRole("tab", { name: /SYS/u });
    fireEvent.click(system);

    expect(system.getAttribute("data-lane")).toBe("system");
    expect(screen.getByRole("heading", { name: "Studio 控制" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /进入 SYS 资源名册/u }));
    expect(openCategory).toHaveBeenCalledWith("system");
  });

  test("offers a real refresh action for the read-only overview", () => {
    const { refresh } = renderCapabilityLibrary();
    fireEvent.click(screen.getByRole("button", { name: /刷新能力索引/u }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
