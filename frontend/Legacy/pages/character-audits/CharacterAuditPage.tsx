import { AlertCircle, UserRoundCheck } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useCharacterAuditController } from "../../../src/application/characterAudits/useCharacterAuditController";
import {
  ACTIVE_CHARACTER_AUDIT_STATUSES,
  CHARACTER_AUDIT_STATUS,
} from "../../../src/application/characterAudits/characterAuditModel";
import { jobCenterViewState } from "../../../src/application/jobs/jobCenterState";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { legacyConfirm } from "../../legacy/legacyInteractions";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { CharacterConfiguration } from "./CharacterConfiguration";
import { CharacterExecution } from "./CharacterExecution";
import { CharacterReview } from "./CharacterReview";
import { CharacterApply } from "./CharacterApply";
import "./character-audits.css";

export function CharacterAuditPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const rescan = useLegacyRescanWorkspace(projectId);
  const c = useCharacterAuditController({
    projectId,
    operationId: search.get("operation"),
    confirm: legacyConfirm,
    onSelectOperation: (id) => setSearch(id ? { operation: id } : {}),
    onReturnToAnnotation: () => navigate(`/workspace/${projectId}/jobs`),
    onOpenPrerequisite: (id) => {
      jobCenterViewState.patch(projectId, { selectedJobId: id });
      navigate(`/workspace/${projectId}/jobs`);
    },
  });
  if (!c.workspace) {
    return (
      <div className="workspace-loading" data-testid="character-workspace-loading">
        {c.status === "error" ? <AlertCircle size={28} /> : <Spinner />}
        <p>{c.message ?? "正在打开角色审查工作台…"}</p>
        {c.status === "error" && <Button onClick={() => navigate("/")}>返回项目首页</Button>}
      </div>
    );
  }
  const op = c.operation;
  return (
    <WorkspaceFrame
      workspace={c.workspace}
      projectId={projectId}
      active="characters"
      rescanning={rescan.isPending}
      rescanDisabled={
        c.dirty ||
        c.busy ||
        c.operations.some((item) => ACTIVE_CHARACTER_AUDIT_STATUSES.has(item.status))
      }
      onRescan={() => rescan.mutate()}
      bodyClassName="character-audit-workspace-body"
      statusbar={
        <>
          <span>角色审查 · {c.operations.length} 个任务</span>
          <span>{c.checkedCount} 个工作台选中项</span>
          <span className="workspace-statusbar__path">修改仅保存至数据库 · Tags 仍需独立复核</span>
        </>
      }
    >
      <aside className="legacy-character-history" data-surface-region="content">
        <header>
          <UserRoundCheck size={20} />
          <div>
            <span className="eyebrow">Character review</span>
            <h2>角色标签审查</h2>
          </div>
        </header>
        <Button
          tone="primary"
          data-testid="character-new"
          disabled={c.busy}
          onClick={() => void c.selectOperation(null)}
        >
          新建角色审查
        </Button>
        <div className="legacy-character-history-scroll">
          {c.operations.map((item) => (
            <button
              type="button"
              key={item.id}
              className="legacy-character-task"
              data-testid={`character-open-${item.id}`}
              aria-pressed={op?.id === item.id}
              disabled={c.busy}
              onClick={() => void c.selectOperation(item.id)}
            >
              <strong>{item.triggers.join(" / ")}</strong>
              <span>{CHARACTER_AUDIT_STATUS[item.status]}</span>
              <small>{new Date(item.updated_at).toLocaleString()}</small>
              {item.error && <small className="legacy-character-error">{item.error}</small>}
            </button>
          ))}
          {!c.operations.length && <p>尚无审查任务，先配置角色与素材归属。</p>}
        </div>
        <p>支持 1–4 个角色，汇总标签与参考图证据，不替代整份 Tags 人工复核。</p>
        <Button data-testid="character-return" onClick={() => void c.returnToAnnotation()}>
          返回打标任务
        </Button>
      </aside>
      <article
        className="legacy-character-workbench"
        data-testid="legacy-character-workbench"
        aria-label="角色标签审查工作台"
      >
        {c.message && (
          <p className="legacy-character-message" role="status" data-testid="character-message">
            {c.message}
          </p>
        )}
        {c.issues.map((issue) => (
          <p className="legacy-character-message" role="alert" key={issue}>
            {issue}
          </p>
        ))}
        {c.status === "loading" && <p role="status">正在读取审查配置与任务…</p>}
        {!op && c.status === "ready" && <CharacterConfiguration content={c} />}
        {op && (
          <>
            <CharacterExecution content={c} />
            {op.reviews.length > 0 && <CharacterReview content={c} />}
            {op.status === "review" && <CharacterApply content={c} />}
            {op.status === "applied" && (
              <p className="legacy-character-message" data-testid="character-applied">
                应用完成 · {op.applied_revision_ids.length} 个 Tags 新修订，整份 Tags 仍需独立复核。
              </p>
            )}
          </>
        )}
      </article>
    </WorkspaceFrame>
  );
}
