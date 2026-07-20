import { useEffect, useState } from "react";
import { Check, CircleStop, FileWarning, Play, RefreshCw } from "lucide-react";

import { useJob, useJobActions } from "../../../features/jobs/hooks";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

export function JobDetailPanel({ projectId, jobId }: { projectId: string; jobId: string | null }) {
  const [itemLimit, setItemLimit] = useState(200);
  const job = useJob(projectId, jobId, itemLimit);
  const actions = useJobActions(projectId);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setItemLimit(200);
    setActionError(null);
  }, [jobId]);

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "任务操作失败。");
    }
  }

  if (!jobId)
    return (
      <section className="job-detail-panel job-detail-panel--empty">
        <p>选择一项任务查看详情。</p>
      </section>
    );
  if (job.isError && !job.data)
    return (
      <section className="job-detail-panel job-detail-panel--empty">
        <FileWarning size={20} />
        <p>{job.error instanceof Error ? job.error.message : "读取任务详情失败。"}</p>
      </section>
    );
  if (!job.data)
    return (
      <section className="job-detail-panel job-detail-panel--empty">
        <Spinner />
      </section>
    );

  const active = ["queued", "running", "stopping"].includes(job.data.status);
  const stopping = job.data.status === "stopping";
  const resumable = ["stopped", "interrupted"].includes(job.data.status);
  const failedItems = job.data.items.filter((item) => item.status === "failed");

  return (
    <section className="job-detail-panel">
      <header>
        <div>
          <span className="eyebrow">Task detail</span>
          <h2>
            {job.data.kind === "translation"
              ? `${job.data.target_language ?? "目标语言"} 译文任务`
              : job.data.system_preset_name}
          </h2>
          <p>
            {job.data.provider_profile_name} · {job.data.model}
            {job.data.kind === "translation" ? ` · ${job.data.system_preset_name}` : ""}
          </p>
        </div>
        <div>
          {active ? (
            <Button
              tone="danger"
              icon={actions.stop.isPending ? <Spinner /> : <CircleStop size={14} />}
              onClick={() => void runAction(() => actions.stop.mutateAsync(job.data.id))}
              disabled={stopping || actions.stop.isPending}
            >
              {stopping ? "正在停止" : "停止任务"}
            </Button>
          ) : null}
          {resumable ? (
            <Button
              tone="primary"
              icon={actions.resume.isPending ? <Spinner /> : <Play size={14} />}
              onClick={() => void runAction(() => actions.resume.mutateAsync(job.data.id))}
              disabled={actions.resume.isPending}
            >
              继续任务
            </Button>
          ) : null}
          {job.data.status === "completed_with_errors" && job.data.failed ? (
            <Button
              icon={actions.retry.isPending ? <Spinner /> : <RefreshCw size={14} />}
              onClick={() => void runAction(() => actions.retry.mutateAsync(job.data.id))}
              disabled={actions.retry.isPending}
            >
              仅重试失败项
            </Button>
          ) : null}
        </div>
      </header>
      {actionError ? <p className="form-error">{actionError}</p> : null}

      <div className="job-summary-grid">
        <div>
          <strong>{job.data.total}</strong>
          <span>总计</span>
        </div>
        <div>
          <strong>{job.data.succeeded}</strong>
          <span>成功</span>
        </div>
        <div>
          <strong>{job.data.running}</strong>
          <span>运行中</span>
        </div>
        <div className={job.data.failed ? "is-alert" : ""}>
          <strong>{job.data.failed}</strong>
          <span>失败</span>
        </div>
      </div>

      <div className="failed-items-header">
        <span>失败与异常项</span>
        <small>
          已显示 {failedItems.length} / {job.data.failed} 项
        </small>
      </div>
      <div className="failed-items-list">
        {failedItems.map((item) => {
          const attempts = [...item.attempts].reverse();
          const adoptableResponse = attempts.find(
            (attempt) => attempt.status === "validation_failed" && attempt.response_content,
          );
          const diagnosticResponse = attempts.find((attempt) => attempt.response_content);
          return (
            <article key={item.id} className="failed-item">
              <header>
                <FileWarning size={14} />
                <strong title={item.relative_path}>{item.relative_path}</strong>
                <span>{item.attempt_count} 次尝试</span>
              </header>
              <p>{item.last_error ?? "未知错误"}</p>
              {diagnosticResponse?.response_content ? (
                <pre>{diagnosticResponse.response_content}</pre>
              ) : null}
              {adoptableResponse?.response_content ? (
                <Button
                  icon={<Check size={13} />}
                  onClick={() =>
                    void runAction(() =>
                      actions.accept.mutateAsync({ jobId: job.data.id, itemId: item.id }),
                    )
                  }
                  disabled={actions.accept.isPending}
                >
                  {job.data.kind === "translation"
                    ? `人工确认并写入 .${job.data.target_language}.txt`
                    : "人工确认并写入 TXT"}
                </Button>
              ) : null}
            </article>
          );
        })}
        {!failedItems.length ? (
          <div className="no-failed-items">
            <Check size={20} />
            <p>当前没有失败项。</p>
          </div>
        ) : null}
        {failedItems.length < job.data.failed ? (
          <Button
            icon={<RefreshCw size={13} />}
            onClick={() => setItemLimit((current) => Math.min(current + 200, job.data.failed))}
            disabled={job.isFetching}
          >
            载入更多失败项
          </Button>
        ) : null}
      </div>
    </section>
  );
}
