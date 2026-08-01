import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  KeyRound,
  Network,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  useHuggingFaceSettings,
  useTaggerDownloadActions,
  useTaggerDownloadCenter,
  useTaggerDownloadTasks,
} from "../../../../src/features/taggers/hooks";
import type {
  HuggingFaceProxyMode,
  HuggingFaceTokenSource,
  TaggerDownloadOffer,
  TaggerDownloadStatus,
  TaggerDownloadTask,
} from "../../../../src/shared/api/types";
import { openExternalUrl } from "../../../../src/shared/desktop/openExternalUrl";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";

const STATUS_LABELS: Record<TaggerDownloadStatus, string> = {
  queued: "等待下载",
  resolving: "检查仓库",
  downloading: "下载中",
  verifying: "校验文件",
  installing: "安装中",
  completed: "已完成",
  paused: "已暂停",
  failed: "失败",
  interrupted: "已中断",
};

const TOKEN_SOURCE_LABELS: Record<HuggingFaceTokenSource, string> = {
  app: "应用已保存 Token",
  environment: "HF_TOKEN 环境变量",
  local_login: "本机 Hugging Face 登录",
  anonymous: "匿名访问",
};

const PROXY_MODE_LABELS: Record<HuggingFaceProxyMode, string> = {
  environment: "跟随环境变量",
  custom: "自定义 HTTP(S) 代理",
  direct: "直接连接",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "估算中";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function TaggerDownloadPanel() {
  const center = useTaggerDownloadCenter();
  const tasksQuery = useTaggerDownloadTasks(Boolean(center.data));
  const connection = useHuggingFaceSettings();
  const actions = useTaggerDownloadActions();
  const [proxyMode, setProxyMode] = useState<HuggingFaceProxyMode>("environment");
  const [proxyUrl, setProxyUrl] = useState("");
  const [token, setToken] = useState("");
  const connectionInitialized = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = center.data;
  const connectionData = connection.data;
  const tasks = useMemo(() => tasksQuery.data ?? data?.tasks ?? [], [data?.tasks, tasksQuery.data]);

  useEffect(() => {
    if (connectionData && !connectionInitialized.current) {
      connectionInitialized.current = true;
      setProxyMode(connectionData.proxy_mode);
    }
  }, [connectionData]);

  const latestTaskByPlan = useMemo(() => {
    const latest = new Map<string, TaggerDownloadTask>();
    for (const task of tasks) {
      if (!latest.has(task.plan_id) && task.status !== "completed") {
        latest.set(task.plan_id, task);
      }
    }
    return latest;
  }, [tasks]);

  async function run<Result>(
    action: () => Promise<Result>,
    success: string | ((result: Result) => string),
  ): Promise<boolean> {
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      setMessage(typeof success === "function" ? success(result) : success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hugging Face 下载操作失败。");
      return false;
    }
  }

  async function saveConnection() {
    const saved = await run(
      () =>
        actions.saveHuggingFace.mutateAsync({
          proxy_mode: proxyMode,
          ...(token.trim() ? { token: token.trim() } : {}),
          ...(proxyUrl.trim() ? { proxy_url: proxyUrl.trim() } : {}),
        }),
      "Hugging Face 连接设置已保存。",
    );
    if (!saved) return;
    setToken("");
    setProxyUrl("");
  }

  async function clearSavedToken() {
    if (!connectionData) return;
    const cleared = await run(
      () =>
        actions.saveHuggingFace.mutateAsync({
          proxy_mode: connectionData.proxy_mode,
          clear_token: true,
        }),
      "应用保存的 Token 已清除。",
    );
    if (cleared) setToken("");
  }

  async function clearSavedProxy() {
    const cleared = await run(
      () =>
        actions.saveHuggingFace.mutateAsync({
          proxy_mode: proxyMode,
          clear_proxy: true,
        }),
      "自定义代理已清除。",
    );
    if (cleared) setProxyUrl("");
  }

  async function removeTask(task: TaggerDownloadTask) {
    if (task.status !== "completed") {
      const confirmed = await confirmDialog(
        `将清理“${task.plan_name}”的下载记录与未完成文件；清理后不能从当前进度继续。`,
        {
          title: "清理下载任务",
          tone: "danger",
          confirmLabel: "清理任务与暂存文件",
        },
      );
      if (!confirmed) return;
    }
    await run(() => actions.remove.mutateAsync(task.id), "下载任务已清理。");
  }

  async function resumeDownload(task: TaggerDownloadTask) {
    await run(() => actions.resume.mutateAsync(task.id), "下载已重新排队。");
  }

  async function startDownload(offer: TaggerDownloadOffer) {
    const accepted = await confirmDialog(
      `“${offer.name}”受 ${offer.license_id} 许可证约束，模型权重不属于 Dataset Studio。请先通过“许可证”按钮阅读原始条款；确认后才会开始下载。`,
      {
        title: "确认模型许可证",
        confirmLabel: "我已阅读并接受",
      },
    );
    if (!accepted) return;
    await run(
      () =>
        actions.create.mutateAsync({
          planId: offer.plan_id,
          licenseAccepted: true,
        }),
      "下载任务已加入队列。",
    );
  }

  if (center.isLoading || connection.isLoading) {
    return (
      <div className="tagger-settings__loading">
        <Spinner label="读取 Hugging Face 模型目录" />
      </div>
    );
  }
  if (center.isError || connection.isError || tasksQuery.isError || !data || !connectionData) {
    const queryError = center.error ?? connection.error ?? tasksQuery.error;
    return (
      <div className="tagger-settings__loading">
        <p className="form-error">
          {queryError instanceof Error ? queryError.message : "无法读取下载中心。"}
        </p>
      </div>
    );
  }

  const busy =
    actions.create.isPending ||
    actions.pause.isPending ||
    actions.resume.isPending ||
    actions.remove.isPending;
  const connectionDraftDirty =
    proxyMode !== connectionData.proxy_mode || Boolean(token.trim()) || Boolean(proxyUrl.trim());

  return (
    <div className="tagger-download-panel">
      <section className="tagger-hf-connection">
        <header>
          <div>
            <span className="eyebrow">Connection</span>
            <h3>Hugging Face 连接</h3>
            <p>Token 保存在系统凭据库中；代理地址不会写入项目或模型清单。</p>
          </div>
          <span className="tagger-hf-identity">
            <KeyRound size={13} />
            {TOKEN_SOURCE_LABELS[connectionData.token_source]}
          </span>
        </header>
        {!connectionData.credential_store_available ? (
          <p className="form-error">
            {connectionData.credential_store_error ??
              "系统凭据库不可用；仍可使用 HF_TOKEN、本机登录与环境代理。"}
          </p>
        ) : null}
        <div className="tagger-hf-form">
          <label className="form-field">
            <span>访问 Token</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              disabled={!connectionData.credential_store_available}
              placeholder={connectionData.has_saved_token ? "已保存；留空保持不变" : "hf_…"}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>网络模式</span>
            <select
              value={proxyMode}
              onChange={(event) => setProxyMode(event.target.value as HuggingFaceProxyMode)}
            >
              {Object.entries(PROXY_MODE_LABELS).map(([value, label]) => (
                <option
                  value={value}
                  key={value}
                  disabled={value === "custom" && !connectionData.credential_store_available}
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>自定义代理</span>
            <input
              value={proxyUrl}
              disabled={proxyMode !== "custom" || !connectionData.credential_store_available}
              placeholder={
                connectionData.has_custom_proxy ? "已保存；留空保持不变" : "http://127.0.0.1:7890"
              }
              onChange={(event) => setProxyUrl(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <div>
            {connectionData.proxy_display ? (
              <small>
                <Network size={12} />
                当前代理：{connectionData.proxy_display}
              </small>
            ) : (
              <small>当前模式未显示代理地址</small>
            )}
          </div>
          <div>
            {connectionData.has_saved_token ? (
              <Button
                disabled={actions.saveHuggingFace.isPending || connectionDraftDirty}
                title={connectionDraftDirty ? "请先保存或撤销当前连接设置草稿" : undefined}
                onClick={() => void clearSavedToken()}
              >
                清除 Token
              </Button>
            ) : null}
            {connectionData.has_custom_proxy ? (
              <Button
                disabled={
                  actions.saveHuggingFace.isPending ||
                  proxyMode === "custom" ||
                  Boolean(token.trim())
                }
                title={
                  proxyMode === "custom"
                    ? "请先切换到环境或直连模式"
                    : token.trim()
                      ? "请先保存或清空 Token 草稿"
                      : undefined
                }
                onClick={() => void clearSavedProxy()}
              >
                清除代理
              </Button>
            ) : null}
            <Button
              icon={actions.testHuggingFace.isPending ? <Spinner /> : <RefreshCw size={13} />}
              disabled={actions.testHuggingFace.isPending || connectionDraftDirty}
              title={connectionDraftDirty ? "请先保存连接设置，再测试已保存的配置" : undefined}
              onClick={() =>
                void run(
                  async () => {
                    const result = await actions.testHuggingFace.mutateAsync();
                    if (!result.connected) throw new Error(result.message);
                    return result;
                  },
                  (result) => `${result.message} 延迟 ${result.latency_ms} ms。`,
                )
              }
            >
              测试已保存连接
            </Button>
            <Button
              tone="primary"
              disabled={
                actions.saveHuggingFace.isPending ||
                (!connectionData.credential_store_available && proxyMode === "custom")
              }
              onClick={() => void saveConnection()}
            >
              保存连接
            </Button>
          </div>
        </footer>
      </section>

      <section className="tagger-download-catalog">
        <header>
          <div>
            <span className="eyebrow">Audited catalog</span>
            <h3>可下载模型</h3>
            <p>只下载适配器声明的固定 revision 与文件，并在安装前核对大小和 SHA-256。</p>
          </div>
          <small>{data.offers.length} 个审核版本</small>
        </header>
        <div className="tagger-download-offers">
          {data.offers.map((offer) => {
            const task = latestTaskByPlan.get(offer.plan_id);
            return (
              <article key={offer.plan_id}>
                <header>
                  <div>
                    <small>{offer.adapter_name}</small>
                    <h4>{offer.name}</h4>
                  </div>
                  <div className="tagger-download-badges">
                    {offer.gated ? <span>门控仓库</span> : null}
                    <span>{offer.provenance === "author" ? "作者发布" : "社区转换"}</span>
                    <span>{offer.license_id}</span>
                  </div>
                </header>
                <p>{offer.description}</p>
                <dl>
                  <div>
                    <dt>下载量</dt>
                    <dd>{formatBytes(offer.download_size)}</dd>
                  </div>
                  <div>
                    <dt>文件</dt>
                    <dd>{offer.file_count}</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd title={offer.revision}>{offer.revision.slice(0, 10)}</dd>
                  </div>
                </dl>
                <code title={offer.revision}>
                  {offer.repo_id}@{offer.revision.slice(0, 10)}
                </code>
                <footer>
                  <Button
                    icon={<ExternalLink size={13} />}
                    onClick={() => void openExternalUrl(offer.source_url)}
                  >
                    仓库
                  </Button>
                  <Button
                    icon={<ExternalLink size={13} />}
                    onClick={() => void openExternalUrl(offer.license_url)}
                  >
                    许可证
                  </Button>
                  <Button
                    tone="primary"
                    icon={
                      actions.create.isPending || actions.resume.isPending ? (
                        <Spinner />
                      ) : task?.can_resume ? (
                        <Play size={13} />
                      ) : (
                        <Download size={13} />
                      )
                    }
                    disabled={Boolean(
                      offer.installed_installation_id || busy || (task && !task.can_resume),
                    )}
                    onClick={() =>
                      task?.can_resume ? void resumeDownload(task) : void startDownload(offer)
                    }
                  >
                    {offer.installed_installation_id
                      ? "已安装"
                      : task?.can_resume
                        ? "继续下载"
                        : task
                          ? STATUS_LABELS[task.status]
                          : "下载并安装"}
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tagger-download-tasks">
        <header>
          <div>
            <span className="eyebrow">Durable queue</span>
            <h3>下载任务</h3>
            <p>同一时间只传输一个模型；暂停、失败或应用重启后均可续传。</p>
          </div>
          <small>{tasks.length}</small>
        </header>
        <div>
          {tasks.map((task) => {
            const progress = Math.min(100, (task.bytes_downloaded / task.bytes_total) * 100);
            const isError = task.status === "failed" || task.status === "interrupted";
            return (
              <article key={task.id} className={isError ? "is-error" : ""}>
                <header>
                  <div>
                    {task.status === "completed" ? (
                      <CheckCircle2 size={15} />
                    ) : isError ? (
                      <CircleAlert size={15} />
                    ) : (
                      <Download size={15} />
                    )}
                    <div>
                      <strong>{task.plan_name}</strong>
                      <small>
                        {STATUS_LABELS[task.status]}
                        {task.stop_requested ? " · 正在安全暂停" : ""}
                      </small>
                    </div>
                  </div>
                  <span>{progress.toFixed(progress < 10 ? 1 : 0)}%</span>
                </header>
                <progress value={task.bytes_downloaded} max={task.bytes_total} />
                <div className="tagger-download-task-meta">
                  <span>
                    {formatBytes(task.bytes_downloaded)} / {formatBytes(task.bytes_total)}
                  </span>
                  <span>
                    {task.files_completed} / {task.files_total} 文件
                  </span>
                  {task.speed_bps ? <span>{formatBytes(task.speed_bps)}/s</span> : null}
                  {task.eta_seconds !== null ? (
                    <span>剩余约 {formatDuration(task.eta_seconds)}</span>
                  ) : null}
                </div>
                {task.current_file ? <code>{task.current_file}</code> : null}
                {task.error_message ? <p>{task.error_message}</p> : null}
                <footer>
                  {task.can_pause ? (
                    <Button
                      icon={<Pause size={13} />}
                      disabled={busy}
                      onClick={() =>
                        void run(() => actions.pause.mutateAsync(task.id), "已请求暂停下载。")
                      }
                    >
                      暂停
                    </Button>
                  ) : null}
                  {task.can_resume ? (
                    <Button
                      tone="primary"
                      icon={<Play size={13} />}
                      disabled={busy}
                      onClick={() => void resumeDownload(task)}
                    >
                      继续
                    </Button>
                  ) : null}
                  {task.can_delete ? (
                    <Button
                      tone={task.status === "completed" ? "quiet" : "danger"}
                      icon={<Trash2 size={13} />}
                      disabled={busy}
                      onClick={() => void removeTask(task)}
                    >
                      清理记录
                    </Button>
                  ) : null}
                </footer>
              </article>
            );
          })}
          {!tasks.length ? (
            <p className="tagger-empty-copy">尚无下载任务。选择一个审核版本开始下载。</p>
          ) : null}
        </div>
      </section>
      {message ? <p className="tagger-action-message">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
