import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FrontendRoutes } from "./FrontendRoutes";
import { readInitialHomeSpaceId } from "./routeState";

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    cleanup();
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

  test("parses the screenshot channel in the neutral route layer", () => {
    expect(readInitialHomeSpaceId("?s=1")).toBe("archive");
    expect(readInitialHomeSpaceId("?s=6")).toBe("capability");
    expect(readInitialHomeSpaceId("?s=99")).toBeUndefined();
  });

  test("renders non-archive spaces through the same complete theme package", async () => {
    renderRoutes("/quality?theme=dial-archive");
    expect(await screen.findByRole("heading", { name: "质量控制" })).toBeTruthy();
    expect(screen.getByLabelText("current route").textContent).toBe("/quality?theme=dial-archive");
  });
});
