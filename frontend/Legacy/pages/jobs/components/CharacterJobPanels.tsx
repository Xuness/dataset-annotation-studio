import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, UserRoundCheck, ArrowUpRight } from "lucide-react";
import { CHARACTER_AUDIT_STATUS } from "../../../../src/application/characterAudits/characterAuditModel";
import {
  jobCenterViewState,
  type JobCenterKind,
} from "../../../../src/application/jobs/jobCenterState";
import {
  useCharacterAudit,
  useCharacterAuditHistory,
} from "../../../../src/application/characterAudits/useCharacterAuditQueries";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { JobKindSelector } from "./JobKindSelector";

export function CharacterJobPanels({
  projectId,
  onKindChange,
}: {
  projectId: string;
  onKindChange: (kind: JobCenterKind) => void;
}) {
  const navigate = useNavigate();
  const { selectedCharacterId } = jobCenterViewState.useValue(projectId);
  const tasks = useCharacterAuditHistory(projectId);
  const detail = useCharacterAudit(projectId, selectedCharacterId);
  useEffect(() => {
    if (!tasks.data) return;
    if (!selectedCharacterId || !tasks.data.some((item) => item.id === selectedCharacterId))
      jobCenterViewState.patch(projectId, { selectedCharacterId: tasks.data[0]?.id ?? null });
  }, [tasks.data, projectId, selectedCharacterId]);
  const op = detail.data;
  return (
    <>
      <aside className="new-job-panel" data-surface-region="primary-sidebar">
        <header>
          <span className="new-job-icon">
            <UserRoundCheck size={18} />
          </span>
          <div>
            <span className="eyebrow">Character review</span>
            <h2>角色审查任务</h2>
          </div>
        </header>
        <JobKindSelector kind="character" onChange={onKindChange} />
        <p>按角色汇总标签并结合参考图审查，模型建议需要人工确认，应用前核对共享图片冲突。</p>
        <p>角色、范围、参考图和模型在角色工作台配置，任务记录与执行状态在这里统一查看。</p>
        <Button
          icon={<Plus size={14} />}
          data-testid="job-character-new"
          onClick={() => navigate(`/workspace/${projectId}/characters`)}
        >
          配置新的角色审查
        </Button>
      </aside>
      <section
        className="job-list-panel"
        data-surface-region="content"
        data-testid="character-job-list"
      >
        <header>
          <span className="eyebrow">Character history</span>
          <strong>角色审查记录</strong>
          <small>{tasks.data?.length ?? 0} 个任务</small>
        </header>
        <div className="job-list-scroll">
          {tasks.isPending && <Spinner />}
          {tasks.error && <p role="alert">{tasks.error.message}</p>}
          {tasks.data?.map((item) => (
            <button
              type="button"
              key={item.id}
              data-testid={`character-open-${item.id}`}
              className={`job-card${selectedCharacterId === item.id ? " is-active" : ""}`}
              onClick={() => jobCenterViewState.patch(projectId, { selectedCharacterId: item.id })}
            >
              <div className="job-card__top">
                <span>{CHARACTER_AUDIT_STATUS[item.status]}</span>
                <small>{new Date(item.updated_at).toLocaleString()}</small>
              </div>
              <strong>{item.triggers.join(" / ")}</strong>
              {item.error && <span className="form-error">{item.error}</span>}
            </button>
          ))}
          {tasks.isSuccess && !tasks.data.length && (
            <div className="job-list-empty">尚无角色审查任务</div>
          )}
        </div>
      </section>
      <section
        className="job-detail-panel character-job-detail"
        data-surface-region="secondary-sidebar"
        data-testid="character-job-detail"
      >
        {detail.isFetching && <Spinner />}
        {detail.error && <p role="alert">{detail.error.message}</p>}
        {op ? (
          <>
            <header>
              <span className="eyebrow">Audit operation</span>
              <h2>{op.request.profiles.map((profile) => profile.trigger).join(" / ")}</h2>
              <p data-testid="character-job-status">{CHARACTER_AUDIT_STATUS[op.status]}</p>
            </header>
            <dl>
              <dt>任务 ID</dt>
              <dd>{op.id}</dd>
              <dt>处理范围</dt>
              <dd>
                {
                  { all: "整个项目", selected: "创建时勾选素材", directory: "指定目录" }[
                    op.request.scope
                  ]
                }{" "}
                · {op.source_assets.length} 张
              </dd>
              <dt>模型</dt>
              <dd>
                {op.provider.name} · {op.provider.model.model_id}
              </dd>
              <dt>模型调用</dt>
              <dd>{op.attempts.length} 次</dd>
              <dt>已确认角色</dt>
              <dd>
                {op.reviews.filter((review) => review.confirmed).length} /{" "}
                {op.request.profiles.length}
              </dd>
            </dl>
            {op.error && (
              <p className="form-error" role="alert">
                {op.error}
              </p>
            )}
            {op.request.profiles.map((profile, index) => (
              <section key={profile.trigger}>
                <h3>{profile.trigger}</h3>
                <p>参考图：{op.references[index]?.relative_path}</p>
                <p>已完成阶段：{op.reviews[index]?.completed_stages.join(" → ") || "尚未执行"}</p>
              </section>
            ))}
            <Button
              icon={<ArrowUpRight size={14} />}
              data-testid="job-character-open-workbench"
              onClick={() =>
                navigate(
                  `/workspace/${projectId}/characters?operation=${encodeURIComponent(op.id)}&entry=${crypto.randomUUID()}`,
                )
              }
            >
              进入角色工作台
            </Button>
          </>
        ) : (
          !detail.isFetching && <p>选择左侧角色任务查看详情</p>
        )}
      </section>
    </>
  );
}
