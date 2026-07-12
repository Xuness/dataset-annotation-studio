import { CircleStop, Clock3, RotateCcw } from "lucide-react";

import type { JobSummary } from "../../../shared/api/types";

const statusLabels: Record<JobSummary["status"], string> = {
  queued: "等待中",
  running: "运行中",
  stopping: "正在停止",
  stopped: "已停止",
  interrupted: "已中断",
  completed: "已完成",
  completed_with_errors: "完成但有异常",
};

export function JobList({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: JobSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="job-list-panel">
      <header>
        <span className="eyebrow">Run history</span>
        <strong>任务记录</strong>
        <small>{jobs.length} 个任务</small>
      </header>
      <div className="job-list-scroll">
        {jobs.map((job) => {
          const finished = job.succeeded + job.failed + job.skipped + job.manually_accepted;
          const progress = job.total ? Math.round((finished / job.total) * 100) : 0;
          return (
            <button
              key={job.id}
              className={`job-card ${selectedId === job.id ? "is-active" : ""}`}
              onClick={() => onSelect(job.id)}
            >
              <div className="job-card__top">
                <span className={`job-state job-state--${job.status}`}>
                  {statusLabels[job.status]}
                </span>
                <small>{new Date(job.created_at).toLocaleString()}</small>
              </div>
              <strong>{job.system_preset_name}</strong>
              <span>{job.provider_profile_name}</span>
              <div className="job-card__progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <footer>
                <span>
                  <Clock3 size={11} /> {finished}/{job.total}
                </span>
                {job.failed ? (
                  <span className="job-card__failed">
                    <RotateCcw size={11} /> {job.failed} 失败
                  </span>
                ) : null}
                {["running", "stopping"].includes(job.status) ? <CircleStop size={12} /> : null}
              </footer>
            </button>
          );
        })}
        {!jobs.length ? (
          <div className="job-list-empty">
            <Clock3 size={22} />
            <p>还没有标注任务。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
