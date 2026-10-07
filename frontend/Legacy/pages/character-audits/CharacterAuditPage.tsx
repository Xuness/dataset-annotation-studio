import { AlertCircle, ArrowLeft, Plus, UserRoundCheck } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCharacterAuditController } from "../../../src/application/characterAudits/useCharacterAuditController";
import { useCharacterAssets } from "../../../src/application/characterAudits/useCharacterAssets";
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
import { PaneResizeHandle } from "../workspace/components/PaneResizeHandle";
import { clamp } from "../workspace/hooks/useWorkspaceLayout";
import { CharacterAssetSidebar } from "./CharacterAssetSidebar";
import { CharacterImagePreview } from "./CharacterImagePreview";
import { CharacterSettings } from "./CharacterSettings";
import { CharacterReview } from "./CharacterReview";
import { CharacterApply } from "./CharacterApply";
import "../workspace/workspace.css";
import "../cropping/cropping.css";
import "./character-audits.css";
import "./character-workbench.css";

export function CharacterAuditPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const rescan = useLegacyRescanWorkspace(projectId);
  const operationId = search.get("operation");
  const c = useCharacterAuditController({
    projectId,
    operationId,
    confirm: legacyConfirm,
    onSelectOperation: (id) => setSearch(id ? { operation: id } : {}),
    onReturnToAnnotation: () => {
      jobCenterViewState.patch(projectId, (current) => ({
        kind: "character",
        selectedCharacterId: operationId ?? current.selectedCharacterId,
      }));
      navigate(`/workspace/${projectId}/jobs`);
    },
    onOpenPrerequisite: (id) => {
      jobCenterViewState.patch(projectId, { kind: "annotation", selectedJobId: id });
      navigate(`/workspace/${projectId}/jobs`);
    },
  });
  const b = useCharacterAssets(projectId, c.operation, search.get("entry"));
  const centerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (b.state.configProfile >= c.form.profiles.length) b.patch({ configProfile: 0 });
  }, [b, c.form.profiles.length]);
  if (!c.workspace)
    return (
      <div className="workspace-loading" data-testid="character-workspace-loading">
        {c.status === "error" ? <AlertCircle size={28} /> : <Spinner />}
        <p>{c.message ?? "正在打开角色审查工作台…"}</p>
        {c.status === "error" && <Button onClick={() => navigate("/")}>返回项目首页</Button>}
      </div>
    );
  const op = c.operation;
  const layout = {
    "--character-assets": `${b.state.assetWidth}px`,
    "--character-settings": `${b.state.settingsWidth}px`,
    "--character-preview": `${b.state.previewPercent}%`,
  } as CSSProperties;
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
      bodyStyle={layout}
      statusbar={
        <>
          <span>角色审查 · {op ? CHARACTER_AUDIT_STATUS[op.status] : "新建配置"}</span>
          <span>{c.checkedCount} 个工作台选中项</span>
          <span className="workspace-statusbar__path">修改仅保存至数据库 · Tags 仍需独立复核</span>
        </>
      }
    >
      <CharacterAssetSidebar browser={b} content={c} />
      <PaneResizeHandle
        orientation="vertical"
        label="调整角色素材栏宽度"
        onResize={(delta) => b.patch({ assetWidth: clamp(b.state.assetWidth + delta, 210, 420) })}
        onReset={() => b.patch({ assetWidth: 260 })}
      />
      <article
        className="character-center"
        data-testid="legacy-character-workbench"
        aria-label="角色标签审查工作台"
      >
        <header className="character-workbench-toolbar">
          <div>
            <span className="eyebrow">Character review</span>
            <h2>
              <UserRoundCheck size={18} />
              {op
                ? op.request.profiles.map((profile) => profile.trigger).join(" / ")
                : "角色标签审查"}
            </h2>
          </div>
          <div className="legacy-character-actions">
            <Button
              icon={<Plus size={14} />}
              data-testid="character-new"
              disabled={c.busy}
              onClick={() => void c.selectOperation(null)}
            >
              新建审查
            </Button>
            <Button
              icon={<ArrowLeft size={14} />}
              data-testid="character-return"
              onClick={() => void c.returnToAnnotation()}
            >
              任务列表
            </Button>
          </div>
        </header>
        <div className="character-center-split" ref={centerRef}>
          <CharacterImagePreview
            key={b.selected?.id ?? "empty"}
            project={projectId}
            asset={b.selected}
            operation={op}
            profileIndex={c.profileIndex}
          />
          <PaneResizeHandle
            orientation="vertical"
            label="调整角色预览与审查比例"
            onResize={(delta) =>
              b.patch({
                previewPercent: clamp(
                  b.state.previewPercent +
                    (delta / centerRef.current!.getBoundingClientRect().width) * 100,
                  30,
                  65,
                ),
              })
            }
            onReset={() => b.patch({ previewPercent: 48 })}
          />
          <section className="character-review-pane" data-testid="character-review-pane">
            <nav className="legacy-character-tabs" aria-label="角色审查视图">
              <Button
                data-testid="character-view-review"
                aria-pressed={b.state.reviewView === "review"}
                onClick={() => b.patch({ reviewView: "review" })}
              >
                标签审阅
              </Button>
              <Button
                data-testid="character-view-apply"
                aria-pressed={b.state.reviewView === "apply"}
                onClick={() => b.patch({ reviewView: "apply" })}
              >
                应用预览
              </Button>
            </nav>
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
            {b.state.reviewView === "review" ? (
              op?.reviews.length ? (
                <CharacterReview content={c} />
              ) : (
                <div className="character-review-empty">
                  <UserRoundCheck size={28} />
                  <h3>{op ? CHARACTER_AUDIT_STATUS[op.status] : "先配置审查任务"}</h3>
                  <p>
                    选择图片核对证据，在右栏配置角色与参考图，模型审查完成后在这里确认汇总标签。
                  </p>
                </div>
              )
            ) : op?.status === "review" ? (
              <CharacterApply content={c} />
            ) : (
              <p className="legacy-character-message">
                完成模型审查并人工确认后，可预览和应用标签修改。
              </p>
            )}
            {op?.status === "applied" && (
              <p className="legacy-character-message" data-testid="character-applied">
                应用完成 · {op.applied_revision_ids.length} 个 Tags 新修订，整份 Tags 仍需独立复核。
              </p>
            )}
          </section>
        </div>
      </article>
      <PaneResizeHandle
        orientation="vertical"
        label="调整角色参数栏宽度"
        onResize={(delta) =>
          b.patch({ settingsWidth: clamp(b.state.settingsWidth - delta, 260, 460) })
        }
        onReset={() => b.patch({ settingsWidth: 300 })}
      />
      <CharacterSettings
        content={c}
        profileIndex={b.state.configProfile}
        onProfileChange={(configProfile) => b.patch({ configProfile })}
      />
    </WorkspaceFrame>
  );
}
