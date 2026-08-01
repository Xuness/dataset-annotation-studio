import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Database,
  FolderOpen,
  MonitorCog,
  RefreshCw,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";

import frontendPackage from "../../../../package.json";
import { useSystemDiagnostics } from "../../../features/system/hooks";
import { API_BASE_URL } from "../../../shared/api/client";
import { resolveDesktopLogDirectory } from "../../../shared/desktop/logDirectories";
import { openLocalFolder } from "../../../shared/desktop/openLocalFolder";
import { isDesktopRuntime } from "../../../shared/desktop/runtime";
import { writeClipboardText } from "../../../shared/desktop/writeClipboardText";
import { SettingsSectionHeader } from "../../../shared/settings/components/SettingsSectionHeader";
import "../../../shared/settings/styles/about-settings.css";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

function formatCheckedAt(timestamp: number): string {
  if (!timestamp) return "尚未完成";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

export function AboutSettings({ onClose }: { onClose: () => void }) {
  const diagnostics = useSystemDiagnostics();
  const desktopRuntime = isDesktopRuntime();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [desktopLogDirectory, setDesktopLogDirectory] = useState<string | null>(null);
  const developmentBuild = import.meta.env.DEV;
  const buildChannel = developmentBuild ? "源码开发版" : "桌面发行版";
  const checkedAt = formatCheckedAt(diagnostics.dataUpdatedAt);
  const activeLogDirectory = diagnostics.data?.log_dir ?? desktopLogDirectory;

  useEffect(() => {
    if (!desktopRuntime) return;

    let disposed = false;
    void resolveDesktopLogDirectory()
      .then((path) => {
        if (!disposed) setDesktopLogDirectory(path);
      })
      .catch(() => {
        // The service-provided directory remains available as a browser and runtime fallback.
      });

    return () => {
      disposed = true;
    };
  }, [desktopRuntime]);

  function diagnosticText(): string {
    const service = diagnostics.data;
    return [
      "Dataset Studio diagnostics",
      `Generated: ${new Date().toISOString()}`,
      `Application: ${frontendPackage.version} (${buildChannel})`,
      `Runtime: ${desktopRuntime ? "Tauri desktop" : "Browser preview"}`,
      `Service: ${service ? "connected" : "unavailable"}`,
      `Backend version: ${service?.version ?? "unavailable"}`,
      `Last check: ${checkedAt}`,
      `API: ${API_BASE_URL}`,
      `App data: ${service?.app_data_dir ?? "unavailable"}`,
      `Logs: ${activeLogDirectory ?? "unavailable"}`,
    ].join("\n");
  }

  async function refreshDiagnostics() {
    setActionMessage(null);
    setActionError(null);
    const result = await diagnostics.refetch();
    if (result.data) {
      setActionMessage(`检测完成 · ${formatCheckedAt(Date.now())}`);
      return;
    }
    setActionError(result.error instanceof Error ? result.error.message : "本地服务没有响应。");
  }

  async function copyDiagnostics() {
    setActionError(null);
    try {
      await writeClipboardText(diagnosticText());
      setActionMessage("诊断摘要已复制");
    } catch (reason) {
      setActionMessage(null);
      setActionError(reason instanceof Error ? reason.message : "无法复制诊断摘要。");
    }
  }

  async function openLogs() {
    if (!activeLogDirectory) return;
    setActionError(null);
    try {
      await openLocalFolder(activeLogDirectory);
      setActionMessage("已打开当前日志目录");
    } catch (reason) {
      setActionMessage(null);
      setActionError(reason instanceof Error ? reason.message : "无法打开日志目录。");
    }
  }

  return (
    <>
      <SettingsSectionHeader
        eyebrow="About & diagnostics"
        title="关于与诊断"
        description="查看当前构建与本地服务状态，在需要排障时复制一份不含私密配置的摘要。"
        actions={
          <Button
            icon={diagnostics.isFetching ? <Spinner /> : <RefreshCw size={14} />}
            disabled={diagnostics.isFetching}
            onClick={() => void refreshDiagnostics()}
          >
            重新检测
          </Button>
        }
        onClose={onClose}
      />

      <div className="about-settings">
        <section className="about-status-grid" aria-label="运行状态">
          <article>
            <span aria-hidden="true">
              <MonitorCog size={18} />
            </span>
            <div>
              <small>Dataset Studio</small>
              <strong>Dataset Studio {frontendPackage.version}</strong>
              <p>
                {buildChannel} · {desktopRuntime ? "Tauri 桌面运行时" : "浏览器预览模式"}
              </p>
            </div>
          </article>

          <article className={diagnostics.isError ? "is-error" : ""}>
            <span aria-hidden="true">
              <Server size={18} />
            </span>
            <div>
              <small>Local service</small>
              <strong>
                {diagnostics.isLoading
                  ? "正在检测…"
                  : diagnostics.data
                    ? "本地服务连接正常"
                    : "服务未连接"}
              </strong>
              <p>
                {diagnostics.data
                  ? `后端 ${diagnostics.data.version} · 最近检测 ${checkedAt}`
                  : "请检查服务进程或启动日志"}
              </p>
            </div>
            {diagnostics.data ? (
              <CheckCircle2 size={16} aria-label="服务正常" />
            ) : diagnostics.isError ? (
              <CircleAlert size={16} aria-label="服务异常" />
            ) : null}
          </article>
        </section>

        <section className="diagnostic-locations">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">Local data</span>
              <h3>本地服务位置</h3>
            </div>
            <Database size={17} aria-hidden="true" />
          </div>

          <dl>
            <div>
              <dt>API 地址</dt>
              <dd title={API_BASE_URL}>{API_BASE_URL}</dd>
            </div>
            <div>
              <dt>应用数据</dt>
              <dd title={diagnostics.data?.app_data_dir}>
                {diagnostics.data?.app_data_dir ?? "服务连接后显示"}
              </dd>
            </div>
            <div>
              <dt>当前日志</dt>
              <dd title={activeLogDirectory ?? undefined}>
                {activeLogDirectory ?? "服务连接后显示"}
              </dd>
            </div>
          </dl>

          <div className="diagnostic-actions">
            <Button
              icon={<FolderOpen size={14} />}
              disabled={!desktopRuntime || !activeLogDirectory}
              onClick={() => void openLogs()}
            >
              打开日志目录
            </Button>
            <Button tone="primary" icon={<Copy size={14} />} onClick={() => void copyDiagnostics()}>
              复制诊断摘要
            </Button>
          </div>
          {actionMessage ? <p className="diagnostic-action-message">{actionMessage}</p> : null}
          {actionError ? <p className="form-error">{actionError}</p> : null}
        </section>
      </div>

      <footer>
        <span>诊断摘要不包含 API Key、Prompt 正文或数据集内容</span>
        <span>最近检测 · {checkedAt}</span>
      </footer>
    </>
  );
}
