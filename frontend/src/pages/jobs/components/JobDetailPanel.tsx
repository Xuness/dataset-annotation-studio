import { Check, CircleStop, FileWarning, Play, RefreshCw } from "lucide-react";

import { useJobDetailController } from "../../../application/jobs/useJobDetailController";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

export function JobDetailPanel({ projectId, jobId }: { projectId: string; jobId: string | null }) {
  const controller = useJobDetailController(projectId, jobId);
  const {
    job,
    error: actionError,
    active,
    stopping,
    resumable,
    exceptionItems,
    exceptionCount,
    stopPending,
    resumePending,
    retryPending,
    acceptPending,
    stop,
    resume,
    retry,
    accept,
    loadMore,
  } = controller;

  if (!jobId)
    return (
      <section
        className="job-detail-panel job-detail-panel--empty workspace-scene-surface"
        data-surface-region="secondary-sidebar"
      >
        <p>选择一项任务查看详情。</p>
      </section>
    );
  if (job.isError && !job.data)
    return (
      <section
        className="job-detail-panel job-detail-panel--empty workspace-scene-surface"
        data-surface-region="secondary-sidebar"
      >
        <FileWarning size={20} />
        <p>{job.error instanceof Error ? job.error.message : "读取任务详情失败。"}</p>
      </section>
    );
  if (!job.data)
    return (
      <section
        className="job-detail-panel job-detail-panel--empty workspace-scene-surface"
        data-surface-region="secondary-sidebar"
      >
        <Spinner />
      </section>
    );

  return (
    <section
      className="job-detail-panel workspace-scene-surface"
      data-surface-region="secondary-sidebar"
    >
      <header>
        <div>
          <span className="eyebrow">Task detail</span>
          <h2>
            {job.data.kind === "translation"
              ? `${
                  job.data.translation_source_kind === "tags" ? "Tags" : "LLM 描述"
                } · ${job.data.target_language ?? "目标语言"} 译文任务`
              : job.data.execution_backend === "local_tagger"
                ? "本地标签标注任务"
                : job.data.system_preset_name}
          </h2>
          <p>
            {job.data.execution_profile_name} · {job.data.model}
            {job.data.kind === "translation" && job.data.system_preset_name
              ? ` · ${job.data.system_preset_name}`
              : ""}
            {job.data.kind === "annotation" && job.data.execution_backend === "provider"
              ? ` · Tags 辅助${job.data.use_tags_as_context ? "已启用" : "未启用"}`
              : ""}
          </p>
        </div>
        <div>
          {active ? (
            <Button
              tone="danger"
              icon={stopPending ? <Spinner /> : <CircleStop size={14} />}
              onClick={() => void stop(job.data.id)}
              disabled={stopping || stopPending}
            >
              {stopping ? "正在停止" : "停止任务"}
            </Button>
          ) : null}
          {resumable ? (
            <Button
              tone="primary"
              icon={resumePending ? <Spinner /> : <Play size={14} />}
              onClick={() => void resume(job.data.id)}
              disabled={resumePending}
            >
              继续任务
            </Button>
          ) : null}
          {job.data.status === "completed_with_errors" && job.data.failed ? (
            <Button
              icon={retryPending ? <Spinner /> : <RefreshCw size={14} />}
              onClick={() => void retry(job.data.id)}
              disabled={retryPending}
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
        {job.data.candidate_results ? (
          <div className="is-alert">
            <strong>{job.data.candidate_results}</strong>
            <span>候选修订</span>
          </div>
        ) : null}
      </div>
      {job.data.candidate_results ? (
        <p className="form-help">
          这些结果生成期间目标通道已被人工修改，因此只保存在标注历史中，没有覆盖当前内容。
        </p>
      ) : null}

      <div className="failed-items-header">
        <span>失败与异常项</span>
        <small>
          已显示 {exceptionItems.length} / {exceptionCount} 项
        </small>
      </div>
      <div className="failed-items-list">
        {exceptionItems.map((item) => {
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
              <p>
                {item.result_disposition === "candidate"
                  ? "目标通道在任务期间发生了修改；结果已保存在标注历史中，当前内容未被覆盖。"
                  : (item.last_error ?? "未知错误")}
              </p>
              {diagnosticResponse?.response_content ? (
                <pre>{diagnosticResponse.response_content}</pre>
              ) : null}
              {adoptableResponse?.response_content ? (
                <Button
                  icon={<Check size={13} />}
                  onClick={() => void accept(job.data.id, item.id)}
                  disabled={acceptPending}
                >
                  {job.data.kind === "translation"
                    ? `人工确认并写入 ${
                        job.data.translation_source_kind === "tags" ? "Tags" : "LLM 描述"
                      } · ${job.data.target_language} 译文通道`
                    : `人工确认并写入${job.data.output_channel === "tags" ? " Tags" : " LLM 描述"}通道`}
                </Button>
              ) : null}
            </article>
          );
        })}
        {!exceptionItems.length ? (
          <div className="no-failed-items">
            <Check size={20} />
            <p>当前没有失败项。</p>
          </div>
        ) : null}
        {exceptionItems.length < exceptionCount ? (
          <Button
            icon={<RefreshCw size={13} />}
            onClick={() => loadMore(exceptionCount)}
            disabled={job.isFetching}
          >
            载入更多失败项
          </Button>
        ) : null}
      </div>
    </section>
  );
}
