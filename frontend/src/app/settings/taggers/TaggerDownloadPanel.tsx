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
import { useEffect, useMemo, useState } from "react";

import { useTaggerDownloadActions, useTaggerDownloadCenter } from "../../../features/taggers/hooks";
import type {
  HuggingFaceProxyMode,
  HuggingFaceTokenSource,
  TaggerDownloadStatus,
  TaggerDownloadTask,
} from "../../../shared/api/types";
import { openExternalUrl } from "../../../shared/desktop/openExternalUrl";
import { formatBytes } from "../../../shared/format/bytes";
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
  const actions = useTaggerDownloadActions();
  const [proxyMode, setProxyMode] = useState<HuggingFaceProxyMode>("environment");
  const [proxyUrl, setProxyUrl] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = center.data;

  useEffect(() => {
    if (data) setProxyMode(data.huggingface.proxy_mode);
  }, [data]);

  const latestTaskByPlan = useMemo(() => {
    const tasks = new Map<string, TaggerDownloadTask>();
    for (const task of data?.tasks ?? []) {
      if (!tasks.has(task.plan_id) && task.status !== "completed") {
        tasks.set(task.plan_id, task);
      }
    }
    return tasks;
  }, [data?.tasks]);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hugging Face 下载操作失败。");
    }
  }

  async function saveConnection() {
    await run(
      () =>
        actions.saveHuggingFace.mutateAsync({
          proxy_mode: proxyMode,
          ...(token.trim() ? { token: token.trim() } : {}),
          ...(proxyUrl.trim() ? { proxy_url: proxyUrl.trim() } : {}),
        }),
      "Hugging Face 连接设置已保存。",
    );
    setToken("");
    setProxyUrl("");
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

  if (center.isLoading) {
    return (
      <div className="tagger-settings__loading">
        <Spinner label="读取 Hugging Face 模型目录" />
      </div>
    );
  }
  if (center.isError || !data) {
    return (
      <div className="tagger-settings__loading">
        <p className="form-error">
          {center.error instanceof Error ? center.error.message : "无法读取下载中心。"}
        </p>
      </div>
    );
  }

  const busy =
    actions.create.isPending ||
    actions.pause.isPending ||
    actions.resume.isPending ||
    actions.remove.isPending;

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
            {TOKEN_SOURCE_LABELS[data.huggingface.token_source]}
          </span>
        </header>
        <div className="tagger-hf-form">
          <label className="form-field">
            <span>访问 Token</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              placeholder={data.huggingface.has_saved_token ? "已保存；留空保持不变" : "hf_…"}
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
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>自定义代理</span>
            <input
              value={proxyUrl}
              disabled={proxyMode !== "custom"}
              placeholder={
                data.huggingface.has_custom_proxy ? "已保存；留空保持不变" : "http://127.0.0.1:7890"
              }
              onChange={(event) => setProxyUrl(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <div>
            {data.huggingface.proxy_display ? (
              <small>
                <Network size={12} />
                当前代理：{data.huggingface.proxy_display}
              </small>
            ) : (
              <small>当前模式未显示代理地址</small>
            )}
          </div>
          <div>
            {data.huggingface.has_saved_token ? (
              <Button
                disabled={actions.saveHuggingFace.isPending}
                onClick={() =>
                  void run(
                    () =>
                      actions.saveHuggingFace.mutateAsync({
                        proxy_mode: proxyMode,
                        clear_token: true,
                      }),
                    "应用保存的 Token 已清除。",
                  )
                }
              >
                清除 Token
              </Button>
            ) : null}
            {data.huggingface.has_custom_proxy ? (
              <Button
                disabled={actions.saveHuggingFace.isPending || proxyMode === "custom"}
                title={proxyMode === "custom" ? "请先切换到环境或直连模式" : undefined}
                onClick={() =>
                  void run(
                    () =>
                      actions.saveHuggingFace.mutateAsync({
                        proxy_mode: proxyMode,
                        clear_proxy: true,
                      }),
                    "自定义代理已清除。",
                  )
                }
              >
                清除代理
              </Button>
            ) : null}
            <Button
              icon={actions.testHuggingFace.isPending ? <Spinner /> : <RefreshCw size={13} />}
              disabled={actions.testHuggingFace.isPending}
              onClick={() =>
                void run(async () => {
                  const result = await actions.testHuggingFace.mutateAsync();
                  if (!result.connected) throw new Error(result.message);
                  setMessage(`${result.message} 延迟 ${result.latency_ms} ms。`);
                }, "Hugging Face 连接测试通过。")
              }
            >
              测试连接
            </Button>
            <Button
              tone="primary"
              disabled={actions.saveHuggingFace.isPending}
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
                    tone="primary"
                    icon={actions.create.isPending ? <Spinner /> : <Download size={13} />}
                    disabled={Boolean(offer.installed_installation_id || task || busy)}
                    onClick={() =>
                      void run(
                        () => actions.create.mutateAsync(offer.plan_id),
                        "下载任务已加入队列。",
                      )
                    }
                  >
                    {offer.installed_installation_id
                      ? "已安装"
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
          <small>{data.tasks.length}</small>
        </header>
        <div>
          {data.tasks.map((task) => {
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
                      onClick={() =>
                        void run(() => actions.resume.mutateAsync(task.id), "下载已重新排队。")
                      }
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
          {!data.tasks.length ? (
            <p className="tagger-empty-copy">尚无下载任务。选择一个审核版本开始下载。</p>
          ) : null}
        </div>
      </section>
      {message ? <p className="tagger-action-message">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
