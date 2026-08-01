import { useRescanWorkspace } from "../../../src/features/workspaces/hooks";
import type { ScanResult } from "../../../src/shared/api/types";
import { alertDialog } from "../../shared/ui/dialogs";

function showScanIssues(result: ScanResult): void {
  if (!result.failed) return;
  const examples = result.issues
    .slice(0, 5)
    .map((issue) => `${issue.path}：${issue.message}`)
    .join("\n");
  void alertDialog(`扫描跳过了 ${result.failed} 个无法读取的图片。\n${examples}`, {
    title: "扫描完成，但有跳过",
  });
}

function showScanError(error: Error): void {
  void alertDialog(error.message, { title: "重新扫描失败" });
}

export function useLegacyRescanWorkspace(projectId: string) {
  return useRescanWorkspace(projectId, {
    onSuccess: showScanIssues,
    onError: showScanError,
  });
}
