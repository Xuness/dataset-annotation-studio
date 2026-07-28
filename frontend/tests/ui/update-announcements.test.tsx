import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SettingsCenter } from "../../src/app/settings/SettingsCenter";
import { UpdateAnnouncementsSettings } from "../../src/app/settings/sections/UpdateAnnouncementsSettings";
import {
  LATEST_UPDATE_ANNOUNCEMENT,
  UPDATE_ANNOUNCEMENTS,
} from "../../src/features/updateAnnouncements/catalog";
import {
  UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY,
  useUpdateAnnouncementReadState,
} from "../../src/features/updateAnnouncements/readState";
import { NavigationRail } from "../../src/layouts/workspace/NavigationRail";
import { HomePage } from "../../src/pages/home/HomePage";
import { useSettingsCenter } from "../../src/shared/settings/settingsCenterStore";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useUpdateAnnouncementReadState.setState({ lastReadAnnouncementId: null });
  useSettingsCenter.setState({ isOpen: false, section: "appearance" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("update announcements", () => {
  test("keeps a unique newest-first catalog independent from the package version", () => {
    const ids = UPDATE_ANNOUNCEMENTS.map((announcement) => announcement.id);
    const publishedDates = UPDATE_ANNOUNCEMENTS.map((announcement) => announcement.publishedAt);

    expect(new Set(ids).size).toBe(ids.length);
    expect(publishedDates).toEqual(
      [...publishedDates].sort((left, right) => right.localeCompare(left)),
    );
    expect(ids[0]).toBe(LATEST_UPDATE_ANNOUNCEMENT.id);
    expect(UPDATE_ANNOUNCEMENTS.every((announcement) => announcement.sections.length > 0)).toBe(
      true,
    );
  });

  test("shows the latest and historical notes and records the latest note as read", async () => {
    render(<UpdateAnnouncementsSettings onClose={() => undefined} />);

    expect(screen.getByRole("heading", { name: "本次更新" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "源码启动与桌面稳定性更新" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "历史版本" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "数据集 ZIP 导出更新" })).toBeTruthy();
    expect(
      screen.getByText(
        "文件夹导出继续要求目标目录为空；ZIP 导出只校验同名压缩包不存在，不会误判所选父目录。",
      ),
    ).toBeTruthy();

    await waitFor(() => {
      expect(window.localStorage.getItem(UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY)).toBe(
        LATEST_UPDATE_ANNOUNCEMENT.id,
      );
      expect(useUpdateAnnouncementReadState.getState().lastReadAnnouncementId).toBe(
        LATEST_UPDATE_ANNOUNCEMENT.id,
      );
    });
  });

  test("clears the settings sidebar unread marker only after opening announcements", async () => {
    const user = userEvent.setup();
    useSettingsCenter.setState({ isOpen: true, section: "appearance" });

    render(<SettingsCenter />);

    const announcementButton = screen.getByRole("button", {
      name: "更新公告，有未读更新公告",
    });
    await user.click(announcementButton);

    expect(await screen.findByRole("heading", { name: "源码启动与桌面稳定性更新" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "更新公告" })).toBeTruthy();
      expect(window.localStorage.getItem(UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY)).toBe(
        LATEST_UPDATE_ANNOUNCEMENT.id,
      );
    });
  });

  test("shows a reactive unread marker on home and workspace settings entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );

    const home = render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "设置，有未读更新公告" })).toBeTruthy();
    home.unmount();

    render(
      <MemoryRouter>
        <NavigationRail projectId="project-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "设置，有未读更新公告" })).toBeTruthy();
    useUpdateAnnouncementReadState.getState().markLatestAnnouncementRead();
    await waitFor(() => expect(screen.getByRole("button", { name: "设置" })).toBeTruthy());
  });
});
