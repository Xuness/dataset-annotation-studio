import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  useTagDictionaryDownloadActions,
  useTagDictionaryDownloadCenter,
  useTagDictionaryDownloadTasks,
} from "../../../features/tagDictionaries/hooks";
import type {
  TagDictionaryDownloadOffer,
  TagDictionaryDownloadStatus,
  TagDictionaryDownloadTask,
} from "../../../shared/api/types";
import { openExternalUrl } from "../../../shared/desktop/openExternalUrl";
import { formatBytes } from "../../../shared/format/bytes";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";

const STATUS_LABELS: Record<TagDictionaryDownloadStatus, string> = {
  queued: "等待下载",
  downloading: "下载中",
  verifying: "校验文件",
  installing: "安装中",
  completed: "已完成",
  paused: "已暂停",
  failed: "失败",
  interrupted: "已中断",
};

const LICENSE_LABELS = {
  verified: "许可证明确",
  mixed: "混合来源",
  undeclared: "授权未声明",
};

function duration(seconds: number | null): string {
  if (seconds === null) return "估算中";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时`;
}

export function TagDictionaryDownloadPanel() {
  const center = useTagDictionaryDownloadCenter();
  const tasksQuery = useTagDictionaryDownloadTasks(Boolean(center.data));
  const actions = useTagDictionaryDownloadActions();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMemo(
    () => tasksQuery.data ?? center.data?.tasks ?? [],
    [center.data?.tasks, tasksQuery.data],
  );
  const taskByOffer = useMemo(() => {
    const values = new Map<string, TagDictionaryDownloadTask>();
    for (const task of tasks) {
      if (!values.has(task.offer_id) && task.status !== "completed") {
        values.set(task.offer_id, task);
      }
    }
    return values;
  }, [tasks]);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "词典下载操作失败。");
    }
  }

  async function start(offer: TagDictionaryDownloadOffer) {
    const accepted = await confirmDialog(
      `${offer.license_notice}\n\n来源：${offer.source_id}\n版本：${offer.source_version}\n\n继续表示你已阅读上游许可证与来源说明，并自行确认当前用途符合授权要求。`,
      {
        title: `确认使用“${offer.name}”`,
        confirmLabel: "已阅读，下载并安装",
      },
    );
    if (!accepted) return;
    await run(() => actions.create.mutateAsync(offer.offer_id), "词典下载已加入队列。");
  }

  async function remove(task: TagDictionaryDownloadTask) {
    if (task.status !== "completed") {
      const accepted = await confirmDialog(
        `将清理“${task.offer_name}”的下载记录与未完成文件，当前进度不能恢复。`,
        {
          title: "清理词典下载",
          tone: "danger",
          confirmLabel: "清理任务",
        },
      );
      if (!accepted) return;
    }
    await run(() => actions.remove.mutateAsync(task.id), "下载记录已清理。");
  }

  if (center.isLoading) {
    return (
      <div className="dictionary-settings__loading">
        <Spinner label="读取在线词典目录" />
      </div>
    );
  }
  if (center.isError || tasksQuery.isError || !center.data) {
    const reason = center.error ?? tasksQuery.error;
    return (
      <div className="dictionary-settings__loading">
        <p className="form-error">
          {reason instanceof Error ? reason.message : "无法读取在线词典目录。"}
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
    <div className="dictionary-online-panel">
      <section className="dictionary-catalog">
        <header>
          <div>
            <span className="eyebrow">Curated sources</span>
            <h3>在线目录</h3>
            <p>固定版本会校验大小与 SHA-256；授权不明确的来源只提供上游入口。</p>
          </div>
          <small>{center.data.offers.length} 个候选来源</small>
        </header>
        <div className="dictionary-offers">
          {center.data.offers.map((offer) => {
            const task = taskByOffer.get(offer.offer_id);
            const manual = offer.download_mode === "manual";
            return (
              <article key={offer.offer_id}>
                <header>
                  <div>
                    <small>{offer.adapter_id}</small>
                    <h4>{offer.name}</h4>
                  </div>
                  <div className="dictionary-badges">
                    <span data-tone={offer.license_status}>
                      {LICENSE_LABELS[offer.license_status]}
                    </span>
                    <span>{manual ? "手动获取" : "内置下载"}</span>
                  </div>
                </header>
                <p>{offer.description}</p>
                <dl>
                  <div>
                    <dt>版本</dt>
                    <dd>{offer.source_version}</dd>
                  </div>
                  <div>
                    <dt>许可证</dt>
                    <dd>{offer.license_id}</dd>
                  </div>
                  <div>
                    <dt>下载量</dt>
                    <dd>{offer.download_size ? formatBytes(offer.download_size) : "上游提供"}</dd>
                  </div>
                </dl>
                <small className="dictionary-license-note">{offer.license_notice}</small>
                <footer>
                  <Button
                    icon={<ExternalLink size={13} />}
                    onClick={() => void openExternalUrl(offer.source_url)}
                  >
                    来源
                  </Button>
                  <Button
                    icon={<ExternalLink size={13} />}
                    onClick={() => void openExternalUrl(offer.license_url)}
                  >
                    授权说明
                  </Button>
                  {manual ? (
                    <Button
                      tone="primary"
                      icon={<ExternalLink size={13} />}
                      onClick={() => void openExternalUrl(offer.source_url)}
                    >
                      前往获取
                    </Button>
                  ) : (
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
                        task?.can_resume
                          ? void run(
                              () => actions.resume.mutateAsync(task.id),
                              "词典下载已重新排队。",
                            )
                          : void start(offer)
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
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dictionary-download-tasks">
        <header>
          <div>
            <span className="eyebrow">Durable queue</span>
            <h3>下载任务</h3>
            <p>暂停、失败或应用重启后可以续传，安装完成后自动进入词典库。</p>
          </div>
          <small>{tasks.length}</small>
        </header>
        <div>
          {tasks.map((task) => {
            const progress = Math.min(
              100,
              task.bytes_total > 0 ? (task.bytes_downloaded / task.bytes_total) * 100 : 0,
            );
            const failed = task.status === "failed" || task.status === "interrupted";
            return (
              <article key={task.id} className={failed ? "is-error" : ""}>
                <header>
                  <div>
                    {task.status === "completed" ? (
                      <CheckCircle2 size={15} />
                    ) : failed ? (
                      <CircleAlert size={15} />
                    ) : (
                      <Download size={15} />
                    )}
                    <div>
                      <strong>{task.offer_name}</strong>
                      <small>{STATUS_LABELS[task.status]}</small>
                    </div>
                  </div>
                  <span>{progress.toFixed(1)}%</span>
                </header>
                <progress max={100} value={progress} />
                <div className="dictionary-task-meta">
                  <span>
                    {formatBytes(task.bytes_downloaded)} / {formatBytes(task.bytes_total)}
                  </span>
                  <span>
                    {task.speed_bps === null ? "测速中" : `${formatBytes(task.speed_bps)}/s`}
                  </span>
                  <span>剩余 {duration(task.eta_seconds)}</span>
                </div>
                {task.error_message ? <p>{task.error_message}</p> : null}
                <footer>
                  {task.can_pause ? (
                    <Button
                      icon={<Pause size={13} />}
                      disabled={busy}
                      onClick={() =>
                        void run(() => actions.pause.mutateAsync(task.id), "词典下载已请求暂停。")
                      }
                    >
                      暂停
                    </Button>
                  ) : null}
                  {task.can_resume ? (
                    <Button
                      icon={<Play size={13} />}
                      disabled={busy}
                      onClick={() =>
                        void run(() => actions.resume.mutateAsync(task.id), "词典下载已重新排队。")
                      }
                    >
                      继续
                    </Button>
                  ) : null}
                  {task.can_delete ? (
                    <Button
                      tone="danger"
                      icon={<Trash2 size={13} />}
                      disabled={busy}
                      onClick={() => void remove(task)}
                    >
                      清理
                    </Button>
                  ) : null}
                </footer>
              </article>
            );
          })}
          {!tasks.length ? <p className="dictionary-empty">目前没有词典下载任务。</p> : null}
        </div>
      </section>

      {message ? <p className="dictionary-action-message">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
