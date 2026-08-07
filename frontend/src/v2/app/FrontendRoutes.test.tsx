import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { FrontendRoutes } from "./FrontendRoutes";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>;
}

function renderRoutes(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <FrontendRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("new frontend routes", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () =>
        ({
          matches: true,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        }) satisfies MediaQueryList,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
  });

  afterEach(() => {
    cleanup();
    useWorkspaceSelectionStore.getState().setActiveProject(null);
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("hands the selected home space to the stable product route while preserving the theme", async () => {
    renderRoutes("/?theme=dial-archive&s=1");
    const enter = await screen.findByRole("button", { name: "进入空间" });
    fireEvent.click(enter);

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/archive?theme=dial-archive",
      );
    });
    expect(await screen.findByRole("heading", { name: "项目档案" })).toBeTruthy();
  });

  test("renders non-archive spaces through the same complete theme package", async () => {
    renderRoutes("/quality?theme=dial-archive");
    expect(await screen.findByRole("heading", { name: "质量控制" })).toBeTruthy();
    expect(screen.getByLabelText("current route").textContent).toBe("/quality?theme=dial-archive");
  });

  test("keeps the preparation workbench as an explicit third-level route", async () => {
    renderRoutes("/preparation/workbench?theme=dial-archive&focus=geometry");

    expect(await screen.findByRole("heading", { name: "任务画布等待项目源" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /返回整备空间/u }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/preparation?theme=dial-archive",
      );
    });
  });

  test("keeps delivery and its workbench as implemented semantic routes", async () => {
    const secondary = renderRoutes("/delivery?theme=dial-archive");
    expect(await screen.findByRole("heading", { name: "尚未装载项目" })).toBeTruthy();
    secondary.unmount();

    renderRoutes("/delivery/workbench?theme=dial-archive");
    expect(await screen.findByRole("heading", { name: "尚未装载项目" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回 05 交付空间" }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/delivery?theme=dial-archive",
      );
    });
  });

  test("mounts the classic capability library while the 3D prototype stays archived", async () => {
    renderRoutes("/capability?theme=dial-archive");

    expect(await screen.findByRole("heading", { name: "能力库" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "能力分类" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /PVD/u }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("CONTENT PENDING")).toBeNull();
    expect(screen.getByLabelText("current route").textContent).toBe(
      "/capability?theme=dial-archive",
    );
  });

  test("enters a semantic capability register from the level-two overview", async () => {
    renderRoutes("/capability?theme=dial-archive");

    fireEvent.click(await screen.findByRole("button", { name: /进入 PVD 资源名册/u }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability/providers?theme=dial-archive",
      );
    });
    expect(screen.getByRole("heading", { name: "模型连接管理台" })).toBeTruthy();
  });

  test("opens the real API provider creation workbench from the provider register", async () => {
    renderRoutes("/capability/providers?theme=dial-archive&view=connections");

    fireEvent.click(await screen.findByRole("button", { name: /新增 API 供应商/u }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability/providers/new?theme=dial-archive",
      );
    });
    expect(await screen.findByRole("heading", { name: "新增 API 供应商" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CREATE CONNECTION" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("keeps the category function lane in the third-level route and enters level four", async () => {
    renderRoutes("/capability/taggers?theme=dial-archive&view=profiles");

    expect(await screen.findByRole("heading", { name: "本地打标配置台" })).toBeTruthy();
    expect(screen.getByLabelText("current route").textContent).toBe(
      "/capability/taggers?theme=dial-archive&view=profiles",
    );
    fireEvent.click(screen.getByRole("button", { name: /RUN.*运行时/u }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability/taggers/runtime?theme=dial-archive",
      );
    });
    expect(screen.getByRole("heading", { name: "本地推理运行时" })).toBeTruthy();
  });

  test("redirects unknown capability category routes to the library overview", async () => {
    renderRoutes("/capability/legacy-settings?theme=dial-archive");

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability?theme=dial-archive",
      );
    });
  });

  test("keeps downloads and Studio controls as distinct third-level modules", async () => {
    const download = renderRoutes("/capability/taggers/downloads?theme=dial-archive");
    expect(await screen.findByRole("heading", { name: "模型下载中心" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /返回TAG工作面/u }));
    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability/taggers?theme=dial-archive&view=profiles",
      );
    });
    download.unmount();

    renderRoutes("/capability/system?theme=dial-archive&view=diagnostics");
    expect(await screen.findByRole("heading", { level: 1, name: "Studio 控制中心" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "本地运行状态" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /BLT.*更新公告/u }));
    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/capability/system?theme=dial-archive&view=announcements",
      );
    });
  });

  test("keeps the annotation stage as an explicit third-level route", async () => {
    renderRoutes("/annotation/stage?theme=dial-archive");

    expect(await screen.findByRole("heading", { name: "素材施工场等待项目源" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /返回标注生产空间/u }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/annotation?theme=dial-archive",
      );
    });
  });

  test("redirects legacy annotation destinations into semantic workcell routes", async () => {
    renderRoutes("/annotation/production?theme=dial-archive&lane=tags");

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/annotation/stage/production?theme=dial-archive&lane=tags",
      );
    });
  });

  test("keeps fourth-level annotation workcells as explicit semantic routes", async () => {
    renderRoutes("/annotation/stage/dossier?theme=dial-archive&section=revisions");

    expect(await screen.findByRole("heading", { name: "素材施工场等待项目源" })).toBeTruthy();
    expect(screen.getByLabelText("current route").textContent).toBe(
      "/annotation/stage/dossier?theme=dial-archive&section=revisions",
    );
  });

  test("preserves project context from home into a selected space", async () => {
    renderRoutes("/?theme=dial-archive&s=2&project=project-42");

    await waitFor(() => {
      expect(useWorkspaceSelectionStore.getState().projectId).toBe("project-42");
    });
    fireEvent.click(await screen.findByRole("button", { name: "进入空间" }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/preparation?theme=dial-archive&project=project-42",
      );
    });
  });

  test("preserves project context when the space rail navigates", async () => {
    renderRoutes("/archive?theme=dial-archive&project=project-42");
    fireEvent.click(await screen.findByRole("button", { name: "进入空间 04 质量控制" }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/quality?theme=dial-archive&project=project-42",
      );
    });
  });

  test("writes a project loaded from the archive into the route context", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            project_id: "project-1",
            name: "Portraits",
            root_path: "D:\\datasets\\portraits",
            exists: true,
            asset_count: 42,
            annotated_count: 17,
            invalid_count: 2,
            created_at: "2026-08-01T10:00:00Z",
            last_opened_at: null,
            settings: {
              json_fields: [],
              recursive_scan: true,
              system_preset_id: null,
              use_tags_as_context: false,
              user_prompt: "",
              validation_mode: "tag_balance",
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderRoutes("/archive?theme=dial-archive");

    fireEvent.click(await screen.findByRole("button", { name: /展开项目档案/ }));
    fireEvent.click(await screen.findByRole("button", { name: /装载为当前项目/ }));

    await waitFor(() => {
      expect(screen.getByLabelText("current route").textContent).toBe(
        "/archive?theme=dial-archive&project=project-1",
      );
      expect(useWorkspaceSelectionStore.getState().projectId).toBe("project-1");
    });
  });
});
