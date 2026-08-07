import { useEffect, useState } from "react";

import frontendPackage from "../../../../../package.json";
import { useSystemDiagnostics } from "../../../../features/system/hooks";
import { UPDATE_ANNOUNCEMENTS } from "../../../../features/updateAnnouncements/catalog";
import {
  useHasUnreadUpdateAnnouncement,
  useUpdateAnnouncementReadState,
} from "../../../../features/updateAnnouncements/readState";
import { API_BASE_URL } from "../../../../shared/api/client";
import { resolveDesktopLogDirectory } from "../../../../shared/desktop/logDirectories";
import { openLocalFolder } from "../../../../shared/desktop/openLocalFolder";
import { isDesktopRuntime } from "../../../../shared/desktop/runtime";
import { writeClipboardText } from "../../../../shared/desktop/writeClipboardText";
import type {
  CapabilitySystemSectionId,
  CapabilitySystemWorkbenchContent,
} from "./capabilityLibraryModel";

interface UseCapabilitySystemWorkbenchControllerOptions {
  sectionId: CapabilitySystemSectionId;
  themeId: string;
  onSelectSection(sectionId: CapabilitySystemSectionId): void;
  onReturnCategory(): void;
  onReturnOverview(): void;
}

const SECTION_PRESENTATION = {
  appearance: {
    title: "界面外观",
    englishLabel: "Appearance Control",
    description: "只管理当前 V2 真正生效的设备本地视觉偏好；Legacy 主题字段不会被无条件迁移。",
  },
  announcements: {
    title: "更新公告",
    englishLabel: "Bulletin Archive",
    description: "浏览本地版本公告归档并维护最新公告的设备本地已读状态。",
  },
  diagnostics: {
    title: "运行诊断",
    englishLabel: "Diagnostics Console",
    description: "查看前后端版本、运行环境与本地目录，并生成不含私密配置的诊断摘要。",
  },
} as const;

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "运行诊断当前不可用。";
}

export function useCapabilitySystemWorkbenchController({
  sectionId,
  themeId,
  onSelectSection,
  onReturnCategory,
  onReturnOverview,
}: UseCapabilitySystemWorkbenchControllerOptions): CapabilitySystemWorkbenchContent {
  const diagnostics = useSystemDiagnostics();
  const hasUnreadAnnouncement = useHasUnreadUpdateAnnouncement();
  const markLatestAnnouncementRead = useUpdateAnnouncementReadState(
    (state) => state.markLatestAnnouncementRead,
  );
  const desktopRuntime = isDesktopRuntime();
  const [desktopLogDirectory, setDesktopLogDirectory] = useState<string | null>(null);
  const presentation = SECTION_PRESENTATION[sectionId];
  const developmentBuild = import.meta.env.DEV;
  const buildChannel = developmentBuild ? "源码开发版" : "桌面发行版";
  const activeLogDirectory = diagnostics.data?.log_dir ?? desktopLogDirectory ?? "";

  useEffect(() => {
    if (!desktopRuntime) return;
    let disposed = false;
    void resolveDesktopLogDirectory()
      .then((path) => {
        if (!disposed) setDesktopLogDirectory(path);
      })
      .catch(() => {
        // The service-provided path remains authoritative when desktop discovery is unavailable.
      });
    return () => {
      disposed = true;
    };
  }, [desktopRuntime]);

  const diagnosticSummary = () =>
    [
      "Dataset Studio diagnostics",
      `Generated: ${new Date().toISOString()}`,
      `Application: ${frontendPackage.version} (${buildChannel})`,
      `Runtime: ${desktopRuntime ? "Tauri desktop" : "Browser preview"}`,
      `Service: ${diagnostics.data ? "connected" : "unavailable"}`,
      `Backend version: ${diagnostics.data?.version ?? "unavailable"}`,
      `API: ${API_BASE_URL}`,
      `App data: ${diagnostics.data?.app_data_dir ?? "unavailable"}`,
      `Logs: ${activeLogDirectory || "unavailable"}`,
    ].join("\n");

  return {
    kind: "capability-system-workbench",
    status:
      sectionId === "diagnostics" && diagnostics.isPending
        ? "loading"
        : sectionId === "diagnostics" && diagnostics.isError
          ? "error"
          : "ready",
    sectionId,
    ...presentation,
    announcements: UPDATE_ANNOUNCEMENTS.map((announcement) => ({
      id: announcement.id,
      version: announcement.version,
      publishedAt: announcement.publishedAt,
      title: announcement.title,
      summary: announcement.summary,
      sectionCount: announcement.sections.length,
      sections: announcement.sections,
    })),
    hasUnreadAnnouncement,
    appearance: {
      themeId,
      palette: themeId === "dial-archive" ? "WARM WHITE / CARBON / SIGNAL" : "THEME DEFINED",
      baseline: "2560×1440",
      preferenceScope: "DEVICE LOCAL",
    },
    diagnostics: {
      frontendVersion: frontendPackage.version,
      buildChannel,
      runtime: desktopRuntime ? "TAURI DESKTOP" : "BROWSER PREVIEW",
      serviceStatus: diagnostics.data
        ? "CONNECTED"
        : diagnostics.isPending
          ? "CHECKING"
          : "OFFLINE",
      backendVersion: diagnostics.data?.version ?? "—",
      apiBaseUrl: API_BASE_URL,
      appDataDir: diagnostics.data?.app_data_dir ?? "服务连接后显示",
      logDir: activeLogDirectory || "服务连接后显示",
    },
    canOpenLogs: desktopRuntime && Boolean(activeLogDirectory),
    pending: diagnostics.isFetching,
    message: diagnostics.isError ? errorMessage(diagnostics.error) : null,
    markLatestAnnouncementRead,
    openLogs: async () => {
      if (desktopRuntime && activeLogDirectory) await openLocalFolder(activeLogDirectory);
    },
    copyDiagnosticSummary: async () => writeClipboardText(diagnosticSummary()),
    refresh: () => {
      void diagnostics.refetch();
    },
    selectSection: onSelectSection,
    returnCategory: onReturnCategory,
    returnOverview: onReturnOverview,
  };
}
