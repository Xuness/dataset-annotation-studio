import { CircleStop, Clock3, RotateCcw } from "lucide-react";

import type { JobSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

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
  hasMore,
  loading,
  loadingMore,
  error,
  onLoadMore,
  onSelect,
}: {
  jobs: JobSummary[];
  selectedId: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="job-list-panel" data-surface-region="content">
      <header>
        <span className="eyebrow">Run history</span>
        <strong>任务记录</strong>
        <small>已显示 {jobs.length} 个任务</small>
      </header>
      <div className="job-list-scroll">
        {loading ? (
          <div className="job-list-empty">
            <Spinner label="读取任务记录" />
          </div>
        ) : null}
        {error ? (
          <div className="job-list-empty">
            <p>{error}</p>
          </div>
        ) : null}
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
              <strong>
                {job.kind === "translation"
                  ? `${
                      job.translation_source_kind === "tags" ? "Tags" : "LLM 描述"
                    } · ${job.target_language ?? "目标语言"} ${
                      job.execution_backend === "local_dictionary" ? "本地词典译文" : "译文"
                    }`
                  : job.execution_backend === "local_tagger"
                    ? "本地标签标注"
                    : job.system_preset_name}
              </strong>
              <span>
                {job.execution_profile_name} · {job.model}
                {job.kind === "translation" && job.system_preset_name
                  ? ` · ${job.system_preset_name}`
                  : ""}
              </span>
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
        {!loading && !error && !jobs.length ? (
          <div className="job-list-empty">
            <Clock3 size={22} />
            <p>还没有任务。</p>
          </div>
        ) : null}
        {hasMore && !error ? (
          <Button
            className="job-list-load-more"
            icon={loadingMore ? <Spinner /> : <RotateCcw size={12} />}
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            载入更早记录
          </Button>
        ) : null}
      </div>
    </section>
  );
}
