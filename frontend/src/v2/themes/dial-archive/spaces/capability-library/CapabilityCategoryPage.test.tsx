import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CapabilityCategoryContent,
  CapabilityLibraryCategory,
  CapabilityLibraryCategoryId,
  CapabilityLibraryInventoryItem,
} from "../../../../pages/spaces/spacePageModel";
import { CapabilityCategoryPage } from "./CapabilityCategoryPage";

afterEach(cleanup);

function resource(
  id: string,
  label: string,
  state: CapabilityLibraryInventoryItem["state"],
  detail: string,
): CapabilityLibraryInventoryItem {
  return {
    id,
    routeId: id,
    groupId: "connections",
    label,
    detail,
    state,
    kindLabel: "PROVIDER PROFILE",
    summary: `${label} 能力对象摘要。`,
    facts: [
      { id: "type", label: "PROTOCOL", value: detail.split(" // ")[0] },
      { id: "models", label: "MODELS", value: "02" },
    ],
    tags: [detail.split(" // ")[0], "MODEL-A"],
    workbenchPath: `/capability/providers/profile/${id}`,
    actionLabel: "配置连接与逐模型参数",
  };
}

function category(
  id: CapabilityLibraryCategoryId,
  index: string,
  code: string,
  label: string,
  lane: "primary" | "system",
  inventory: readonly CapabilityLibraryInventoryItem[] = [],
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
    englishLabel: `${label} English`,
    description: `${label}能力摘要`,
    lane,
    state: "ready",
    stateLabel: "ONLINE",
    headlineValue: String(inventory.length),
    headlineLabel: "REGISTERED RESOURCES",
    summary: `${label}能力索引已就绪。`,
    notice: null,
    metrics: [{ id: "count", label: "COUNT", value: String(inventory.length) }],
    groups: [
      {
        id: defaultGroupId,
        code: "REG",
        label: "连接档案",
        englishLabel: "Connections",
        description: "连接、认证与逐模型参数。",
        count: inventory.length,
      },
    ],
    defaultGroupId,
    inventory,
  };
}

function renderCategoryPage() {
  const resources = [
    resource("provider-openai", "OpenAI Main", "ready", "OPENAI_COMPATIBLE // GPT"),
    resource("provider-gemini", "Gemini Edge", "attention", "GEMINI // FLASH"),
  ];
  const categories = [
    category("providers", "01", "PVD", "模型连接", "primary", resources),
    category("taggers", "02", "TAG", "本地打标", "primary"),
    category("dictionaries", "03", "DIC", "Tag 词典", "primary"),
    category("prompts", "04", "PRM", "Prompt 协议", "primary"),
    category("system", "S1", "SYS", "Studio 控制", "system"),
  ];
  const selectCategory = vi.fn();
  const selectGroup = vi.fn();
  const selectResource = vi.fn();
  const createResource = vi.fn();
  const openResource = vi.fn();
  const openActiveResource = vi.fn();
  const returnOverview = vi.fn();
  const refresh = vi.fn();
  const content: CapabilityCategoryContent = {
    kind: "capability-category",
    status: "ready",
    categories,
    category: categories[0]!,
    groups: categories[0]!.groups,
    activeGroupId: "connections",
    activeGroup: categories[0]!.groups[0]!,
    resources,
    activeResourceId: resources[0].id,
    activeResource: resources[0],
    createResourceLabel: "新增 API 供应商",
    message: null,
    selectCategory,
    selectGroup,
    selectResource,
    openResource,
    createResource,
    openActiveResource,
    returnOverview,
    refresh,
  };

  render(<CapabilityCategoryPage content={content} />);
  return {
    refresh,
    returnOverview,
    selectCategory,
    selectGroup,
    selectResource,
    openResource,
    createResource,
    openActiveResource,
  };
}

describe("classic capability category register", () => {
  test("searches and filters the complete resource register without replacing the selected object", () => {
    renderCategoryPage();

    expect(screen.getByRole("heading", { name: "模型连接管理台" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "OpenAI Main" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索连接档案"), {
      target: { value: "gemini" },
    });
    expect(screen.getByRole("button", { name: /Gemini Edge/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /OpenAI Main/u })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("搜索连接档案"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "待检查" }));
    expect(screen.getByRole("button", { name: /Gemini Edge/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /OpenAI Main/u })).toBeNull();
  });

  test("routes category and resource selection while keeping level-four actions explicit", () => {
    const {
      createResource,
      openActiveResource,
      refresh,
      returnOverview,
      selectCategory,
      selectResource,
    } = renderCategoryPage();

    fireEvent.click(screen.getByRole("button", { name: /新增 API 供应商/u }));
    expect(createResource).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /Gemini Edge/u }));
    expect(selectResource).toHaveBeenCalledWith("provider-gemini");

    fireEvent.click(screen.getByRole("button", { name: "进入 TAG 本地打标管理页" }));
    expect(selectCategory).toHaveBeenCalledWith("taggers");

    fireEvent.click(screen.getByRole("button", { name: /配置连接与逐模型参数/u }));
    expect(openActiveResource).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /刷新连接索引/u }));
    expect(refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /返回能力库/u }));
    expect(returnOverview).toHaveBeenCalledOnce();
  });
});
