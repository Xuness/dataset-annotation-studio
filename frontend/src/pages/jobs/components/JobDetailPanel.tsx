import { Check, CircleStop, FileWarning, Play, RefreshCw } from "lucide-react";

import { useJob, useJobActions } from "../../../features/jobs/hooks";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

export function JobDetailPanel({ projectId, jobId }: { projectId: string; jobId: string | null }) {
  const job = useJob(projectId, jobId);
  const actions = useJobActions(projectId);

  if (!jobId)
    return (
      <section className="job-detail-panel job-detail-panel--empty">
        <p>选择一项任务查看详情。</p>
      </section>
    );
  if (!job.data)
    return (
      <section className="job-detail-panel job-detail-panel--empty">
        <Spinner />
      </section>
    );

  const active = ["queued", "running", "stopping"].includes(job.data.status);
  const resumable = ["stopped", "interrupted"].includes(job.data.status);
  const failedItems = job.data.items.filter((item) => item.status === "failed");

  return (
    <section className="job-detail-panel">
      <header>
        <div>
          <span className="eyebrow">Task detail</span>
          <h2>{job.data.system_preset_name}</h2>
          <p>{job.data.provider_profile_name}</p>
        </div>
        <div>
          {active ? (
            <Button
              tone="danger"
              icon={actions.stop.isPending ? <Spinner /> : <CircleStop size={14} />}
              onClick={() => void actions.stop.mutateAsync(job.data.id)}
              disabled={actions.stop.isPending}
            >
              停止任务
            </Button>
          ) : null}
          {resumable ? (
            <Button
              tone="primary"
              icon={<Play size={14} />}
              onClick={() => void actions.resume.mutateAsync(job.data.id)}
            >
              继续任务
            </Button>
          ) : null}
          {job.data.failed ? (
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => void actions.retry.mutateAsync(job.data.id)}
            >
              仅重试失败项
            </Button>
          ) : null}
        </div>
      </header>

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
        <small>{failedItems.length} 项</small>
      </div>
      <div className="failed-items-list">
        {failedItems.map((item) => {
          const response = [...item.attempts].reverse().find((attempt) => attempt.response_content);
          return (
            <article key={item.id} className="failed-item">
              <header>
                <FileWarning size={14} />
                <strong title={item.relative_path}>{item.relative_path}</strong>
                <span>{item.attempt_count} 次尝试</span>
              </header>
              <p>{item.last_error ?? "未知错误"}</p>
              {response?.response_content ? <pre>{response.response_content}</pre> : null}
              {response?.response_content ? (
                <Button
                  icon={<Check size={13} />}
                  onClick={() =>
                    void actions.accept.mutateAsync({ jobId: job.data.id, itemId: item.id })
                  }
                  disabled={actions.accept.isPending}
                >
                  人工确认并写入 TXT
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
      </div>
    </section>
  );
}
