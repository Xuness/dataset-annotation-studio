import { CircleStop, Filter, Play, RefreshCw, RotateCcw } from "lucide-react";

import type {
  AssetFolderSummary,
  ScreeningCapabilities,
  ScreeningOperation,
  ScreeningProfile,
  ScreeningStrength,
} from "../../../../src/shared/api/types";
import type { ScreeningFormState } from "../../../../src/application/screening/screeningState";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

const fallbackProfiles: Array<{ id: ScreeningProfile; label: string }> = [
  { id: "character_lora", label: "角色 LoRA" },
];

const fallbackStrengths: Array<{ id: ScreeningStrength; label: string }> = [
  { id: "conservative", label: "保守" },
  { id: "balanced", label: "均衡" },
  { id: "aggressive", label: "积极" },
];

interface Props {
  form: ScreeningFormState;
  capabilities: ScreeningCapabilities | undefined;
  capabilitiesPending: boolean;
  capabilitiesError: string | null;
  assetCount: number;
  checkedCount: number;
  folderOptions: AssetFolderSummary[];
  folderCount: number;
  folderLoading: boolean;
  scopeReady: boolean;
  scopeMessage: string | null;
  error: string | null;
  activeOperation: ScreeningOperation | undefined;
  selectedOperation: ScreeningOperation | null;
  createPending: boolean;
  stopPending: boolean;
  resumePending: boolean;
  applyTaskProfilePending: boolean;
  onChange: (update: Partial<ScreeningFormState>) => void;
  onToggleFolder: (path: string) => void;
  onClearFolders: () => void;
  onCreate: () => void;
  onStop: () => void;
  onResume: () => void;
  onApplyTaskProfile: () => void;
}

export function ScreeningSetupPanel({
  form,
  capabilities,
  capabilitiesPending,
  capabilitiesError,
  assetCount,
  checkedCount,
  folderOptions,
  folderCount,
  folderLoading,
  scopeReady,
  scopeMessage,
  error,
  activeOperation,
  selectedOperation,
  createPending,
  stopPending,
  resumePending,
  applyTaskProfilePending,
  onChange,
  onToggleFolder,
  onClearFolders,
  onCreate,
  onStop,
  onResume,
  onApplyTaskProfile,
}: Props) {
  const profiles = capabilities?.task_profiles.length
    ? capabilities.task_profiles.map((profile) => ({
        id: profile,
        label: fallbackProfiles.find((option) => option.id === profile)?.label ?? profile,
      }))
    : fallbackProfiles;
  const strengths: Array<{
    id: ScreeningStrength;
    label: string;
    description?: string | null;
  }> = capabilities?.intensities.length
    ? capabilities.intensities.map((strength) => ({
        id: strength,
        label: fallbackStrengths.find((option) => option.id === strength)?.label ?? strength,
      }))
    : fallbackStrengths;
  const scopeCount =
    form.scope === "all" ? assetCount : form.scope === "selected" ? checkedCount : folderCount;
  const canCreate =
    scopeReady &&
    !createPending &&
    !activeOperation &&
    Boolean(capabilities) &&
    scopeCount <= (capabilities?.max_assets_per_operation ?? Number.POSITIVE_INFINITY) &&
    !capabilitiesPending;
  const canResume = ["stopped", "interrupted"].includes(selectedOperation?.status ?? "");

  return (
    <section className="screening-setup">
      <header className="screening-panel-heading">
        <span className="screening-panel-icon">
          <Filter size={16} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">Batch Metadata Rank</span>
          <h2>本次筛选</h2>
        </div>
      </header>

      <div className="screening-runtime-note" data-testid="screening-runtime-mode">
        <strong>MetaRank Batch</strong>
        <span>{capabilities?.score_version ?? "正在读取公式版本"} · 仅本批次排名</span>
        <small>运行时只读取本任务图片及其同名 JSON，不扫描 Danbooru 全站归档。</small>
      </div>

      <div className="screening-scope" role="group" aria-label="筛选范围">
        <button
          type="button"
          className={form.scope === "all" ? "is-active" : ""}
          onClick={() => onChange({ scope: "all" })}
        >
          整个项目 <span>{assetCount}</span>
        </button>
        <button
          type="button"
          className={form.scope === "folder" ? "is-active" : ""}
          onClick={() => onChange({ scope: "folder" })}
        >
          指定文件夹 <span>{folderLoading ? "…" : folderCount}</span>
        </button>
        <button
          type="button"
          className={form.scope === "selected" ? "is-active" : ""}
          onClick={() => onChange({ scope: "selected" })}
        >
          工作台勾选 <span>{checkedCount}</span>
        </button>
      </div>

      {form.scope === "folder" ? (
        <div className="screening-folder-picker">
          <header>
            <span>已选 {form.folderPaths.length} 个文件夹</span>
            <button type="button" disabled={!form.folderPaths.length} onClick={onClearFolders}>
              清空
            </button>
          </header>
          <div>
            {folderOptions.map((folder) => (
              <label key={folder.path} title={folder.path}>
                <input
                  type="checkbox"
                  checked={form.folderPaths.includes(folder.path)}
                  onChange={() => onToggleFolder(folder.path)}
                />
                <span>{folder.path}</span>
                <small>{folder.descendant_asset_count}</small>
              </label>
            ))}
            {!folderLoading && !folderOptions.length ? <p>没有可选的素材子文件夹。</p> : null}
          </div>
        </div>
      ) : null}

      <label className="form-field screening-field">
        <span>任务配置</span>
        <select
          value={form.profile}
          onChange={(event) => onChange({ profile: event.target.value as ScreeningProfile })}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="screening-task-rules">
        <legend>角色 LoRA 任务适配</legend>
        <p>命中已启用类型时只降低任务排序分，不改写 MetaRank 核心质量分。</p>
        {[
          ["comic_panel", "降低漫画 / 分镜（适配度 20%）"],
          ["multiple_views", "降低多视图 / 设定图（20%）"],
          ["monochrome_greyscale", "降低黑白 / 灰度（30%）"],
          ["lineart_sketch", "降低线稿 / 草图（20%）"],
          ["crowd_3plus", "降低三人及以上（55% → 20%）"],
        ].map(([rule, label]) => {
          const key = rule as keyof typeof form.taskRules;
          return (
            <label key={rule}>
              <input
                type="checkbox"
                checked={form.taskRules[key]}
                onChange={(event) =>
                  onChange({
                    taskRules: { ...form.taskRules, [key]: event.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          );
        })}
        <small>
          {capabilities?.task_profile_versions.character_lora ?? "character-lora-v1"}
          ・所有规则均可关闭，未命中时任务适配度为 100%。
        </small>
        {selectedOperation?.status === "completed" && selectedOperation.task_profile_snapshot ? (
          <button
            type="button"
            className="screening-apply-profile"
            disabled={applyTaskProfilePending}
            onClick={onApplyTaskProfile}
          >
            <RefreshCw className={applyTaskProfilePending ? "is-spinning" : ""} size={13} />
            {applyTaskProfilePending ? "正在重新计算…" : "应用到当前结果"}
          </button>
        ) : selectedOperation?.status === "completed" ? (
          <small>该历史任务没有缓存标签特征，需要重新运行后才能切换适配规则。</small>
        ) : null}
      </fieldset>

      <fieldset className="screening-strength">
        <legend>筛选力度</legend>
        <div>
          {strengths.map((strength) => (
            <button
              key={strength.id}
              type="button"
              className={form.strength === strength.id ? "is-active" : ""}
              title={strength.description ?? undefined}
              onClick={() => onChange({ strength: strength.id })}
            >
              {strength.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="form-field screening-field">
        <span>元数据快照回退时间</span>
        <input
          type="datetime-local"
          value={form.metadataSnapshotAtFallback}
          onChange={(event) => onChange({ metadataSnapshotAtFallback: event.target.value })}
        />
        <small>仅在 JSON 没有快照时间时使用；留空则冻结同名 JSON 的修改时间并给出警告。</small>
      </label>

      <div className="screening-safety-note">
        <strong>只读初筛</strong>
        <span>不会删除、移动或改写图片与 JSON；低分辨率和变体只做标记。</span>
      </div>

      {scopeMessage ? <p className="form-hint">{scopeMessage}</p> : null}
      {capabilitiesError ? <p className="form-error">{capabilitiesError}</p> : null}
      {capabilities && scopeCount > capabilities.max_assets_per_operation ? (
        <p className="form-error">
          当前范围超过单次上限 {capabilities.max_assets_per_operation}{" "}
          张，请改用文件夹或工作台勾选。
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="screening-setup-actions">
        {activeOperation ? (
          <Button
            icon={stopPending ? <Spinner /> : <CircleStop size={14} />}
            disabled={stopPending || activeOperation.status === "stopping"}
            onClick={onStop}
          >
            {activeOperation.status === "stopping" ? "正在停止" : "停止"}
          </Button>
        ) : canResume ? (
          <Button
            icon={resumePending ? <Spinner /> : <RotateCcw size={14} />}
            disabled={resumePending}
            onClick={onResume}
          >
            继续任务
          </Button>
        ) : null}
        <Button
          tone="primary"
          icon={createPending ? <Spinner /> : <Play size={14} />}
          disabled={!canCreate}
          onClick={onCreate}
        >
          筛选 {scopeCount} 张图片
        </Button>
      </div>
    </section>
  );
}
