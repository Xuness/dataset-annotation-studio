import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAssets } from "../../features/assets/hooks";
import { useExportActions, useExportOperations } from "../../features/exports/hooks";
import { useRescanWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import type { ExportRequest } from "../../shared/api/types";
import { openLocalFolder } from "../../shared/desktop/openLocalFolder";
import { pickExportFolder } from "../../shared/desktop/pickFolder";
import { useAppStore } from "../../shared/store/appStore";
import { Button } from "../../shared/ui/Button";
import { alertDialog, confirmDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import { ExportHistoryPanel } from "./components/ExportHistoryPanel";
import { ExportPreviewPanel } from "./components/ExportPreviewPanel";
import { ExportSettingsPanel } from "./components/ExportSettingsPanel";
import "./export.css";
import type { ExportFormState } from "./types";

const initialForm: ExportFormState = {
  scope: "all",
  destinationPath: "",
  channels: ["existing_annotation"],
  translationLanguage: "zh-CN",
  revision: "confirmed",
  formats: ["txt"],
};

const activeStatuses = new Set(["queued", "running", "stopping"]);

export function ExportPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 1 });
  const rescan = useRescanWorkspace(projectId);
  const operations = useExportOperations(projectId);
  const actions = useExportActions(projectId);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);

  useEffect(() => {
    setActiveProject(projectId);
    setForm(initialForm);
    setError(null);
    setPreviewFingerprint(null);
  }, [projectId, setActiveProject]);

  const request = useMemo<ExportRequest>(
    () => ({
      scope: form.scope,
      asset_ids: form.scope === "selected" ? checkedAssetIds : [],
      destination_path: form.destinationPath,
      channels: form.channels.map((channel) => ({
        channel,
        language: channel === "translation" ? form.translationLanguage : "",
        revision: form.revision,
      })),
      formats: form.formats,
    }),
    [checkedAssetIds, form],
  );
  const requestFingerprint = useMemo(
    () => JSON.stringify([projectId, request]),
    [projectId, request],
  );
  const validPreview = previewFingerprint === requestFingerprint ? actions.preview.data : undefined;
  const activeExport = Boolean(
    operations.data?.some((operation) => activeStatuses.has(operation.status)),
  );
  const actionPending =
    actions.create.isPending || actions.stop.isPending || actions.resume.isPending;

  if (workspace.isError) {
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>{workspace.error instanceof Error ? workspace.error.message : "工作区不可用。"}</p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  }
  if (!workspace.data) {
    return (
      <div className="workspace-loading">
        <Spinner />
        <p>正在打开导出工作台…</p>
      </div>
    );
  }

  async function chooseFolder() {
    setError(null);
    try {
      const selected = await pickExportFolder();
      if (selected) setForm((current) => ({ ...current, destinationPath: selected }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法选择导出目录。");
    }
  }

  async function preview() {
    setError(null);
    setPreviewFingerprint(null);
    try {
      await actions.preview.mutateAsync(request);
      setPreviewFingerprint(requestFingerprint);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法校验导出范围。");
    }
  }

  async function startExport() {
    const previewData = validPreview;
    if (!previewData || previewData.blocking_issue_count) return;
    let allowWarnings = false;
    if (previewData.warning_count) {
      const confirmed = await confirmDialog(
        [
          `所选 ${previewData.total_items} 张图片中发现 ${previewData.warning_count} 个标注警告：`,
          `未标注 ${previewData.missing_count}，空内容 ${previewData.empty_count}，`,
          `待确认 ${previewData.unreviewed_count}，已过期 ${previewData.stale_count}，`,
          `结构异常 ${previewData.invalid_count}，编码异常 ${previewData.encoding_error_count}。`,
          "继续后会严格使用当前预览冻结的数据库修订；缺失通道不会生成对应标注文件。",
        ].join("\n"),
        {
          title: "发现标注问题",
          tone: "danger",
          confirmLabel: "忽略警告并导出",
          cancelLabel: "返回检查",
        },
      );
      if (!confirmed) return;
      allowWarnings = true;
    } else {
      const confirmed = await confirmDialog(
        `将 ${previewData.total_items} 张图片及所选标注通道物化到导出目录？`,
        {
          title: "开始导出",
          confirmLabel: "开始导出",
        },
      );
      if (!confirmed) return;
    }

    setError(null);
    try {
      await actions.create.mutateAsync({
        request,
        previewToken: previewData.preview_token,
        allowWarnings,
      });
      actions.preview.reset();
      setPreviewFingerprint(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建导出任务。");
    }
  }

  async function stop(operationId: string) {
    const confirmed = await confirmDialog(
      "停止后已完成的输出文件会保留在导出目录中，之后可以继续任务。",
      {
        title: "停止导出",
        confirmLabel: "停止",
      },
    );
    if (!confirmed) return;
    setError(null);
    try {
      await actions.stop.mutateAsync(operationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法停止导出任务。");
    }
  }

  async function resume(operationId: string) {
    setError(null);
    try {
      await actions.resume.mutateAsync(operationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法继续导出任务。");
    }
  }

  async function openFolder(path: string) {
    try {
      await openLocalFolder(path);
    } catch (reason) {
      await alertDialog(reason instanceof Error ? reason.message : "无法打开导出目录。", {
        title: "打开目录失败",
      });
    }
  }

  return (
    <WorkspaceFrame
      workspace={workspace.data}
      projectId={projectId}
      active="export"
      rescanning={rescan.isPending}
      rescanDisabled={activeExport}
      onRescan={() => rescan.mutate()}
      bodyClassName="export-workspace-body"
      statusbar={
        <>
          <span>多通道导出 · 数据库修订物化为 TXT / JSON</span>
          <span className="workspace-statusbar__path">
            任务状态：.annotation-workspace/state.sqlite3
          </span>
        </>
      }
    >
      <ExportSettingsPanel
        form={form}
        assetCount={assets.data?.total ?? workspace.data.asset_count}
        checkedCount={checkedAssetIds.length}
        preview={validPreview}
        previewPending={actions.preview.isPending}
        exportPending={actionPending}
        activeExport={activeExport}
        error={error}
        onChange={(update) => setForm((current) => ({ ...current, ...update }))}
        onChooseFolder={() => void chooseFolder()}
        onPreview={() => void preview()}
        onExport={() => void startExport()}
      />
      <ExportPreviewPanel preview={validPreview} />
      <ExportHistoryPanel
        operations={operations.data ?? []}
        actionPending={actionPending}
        onStop={(id) => void stop(id)}
        onResume={(id) => void resume(id)}
        onOpenFolder={(path) => void openFolder(path)}
      />
    </WorkspaceFrame>
  );
}
