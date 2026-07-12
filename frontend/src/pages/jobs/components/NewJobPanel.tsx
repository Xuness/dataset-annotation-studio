import { useEffect, useState } from "react";
import { Bot, Play, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useJobActions } from "../../../features/jobs/hooks";
import { useProviderProfiles, useSystemPresets } from "../../../features/presets/hooks";
import type { JobDetail, WorkspaceSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

interface NewJobPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  checkedAssetIds: string[];
  onCreated: (job: JobDetail) => void;
}

export function NewJobPanel({
  projectId,
  workspace,
  checkedAssetIds,
  onCreated,
}: NewJobPanelProps) {
  const navigate = useNavigate();
  const systemPresets = useSystemPresets();
  const providerProfiles = useProviderProfiles();
  const actions = useJobActions(projectId);
  const [systemPresetId, setSystemPresetId] = useState("");
  const [providerProfileId, setProviderProfileId] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!systemPresetId && systemPresets.data?.length) {
      setSystemPresetId(systemPresets.data[0].id);
    }
  }, [systemPresetId, systemPresets.data]);

  useEffect(() => {
    if (!providerProfileId && providerProfiles.data?.length) {
      setProviderProfileId(providerProfiles.data[0].id);
    }
  }, [providerProfileId, providerProfiles.data]);

  async function create() {
    setError(null);
    try {
      const job = await actions.create.mutateAsync({
        system_preset_id: systemPresetId,
        provider_profile_id: providerProfileId,
        scope,
        asset_ids: scope === "selected" ? checkedAssetIds : [],
      });
      onCreated(job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建任务。 ");
    }
  }

  const ready = Boolean(
    systemPresetId && providerProfileId && (scope === "all" || checkedAssetIds.length > 0),
  );

  return (
    <aside className="new-job-panel">
      <header>
        <span className="new-job-icon">
          <Bot size={18} />
        </span>
        <div>
          <span className="eyebrow">New annotation run</span>
          <h2>创建标注任务</h2>
        </div>
      </header>

      <label className="form-field">
        <span>System Prompt 预设</span>
        <select value={systemPresetId} onChange={(event) => setSystemPresetId(event.target.value)}>
          {!systemPresets.data?.length ? <option value="">尚未创建预设</option> : null}
          {systemPresets.data?.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span>API 配置</span>
        <select
          value={providerProfileId}
          onChange={(event) => setProviderProfileId(event.target.value)}
        >
          {!providerProfiles.data?.length ? <option value="">尚未创建 API 配置</option> : null}
          {providerProfiles.data?.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.model}
            </option>
          ))}
        </select>
      </label>

      <div className="job-scope">
        <span>处理范围</span>
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          全部未标注 <small>{Math.max(workspace.asset_count - workspace.annotated_count, 0)}</small>
        </button>
        <button
          className={scope === "selected" ? "is-active" : ""}
          onClick={() => setScope("selected")}
        >
          工作台选中项 <small>{checkedAssetIds.length}</small>
        </button>
      </div>

      <dl className="job-rules">
        <div>
          <dt>已有 TXT</dt>
          <dd>自动跳过</dd>
        </div>
        <div>
          <dt>失败重试</dt>
          <dd>首次 + 3 次</dd>
        </div>
        <div>
          <dt>输出处理</dt>
          <dd>原样写入</dd>
        </div>
        <div>
          <dt>User Prompt</dt>
          <dd>{workspace.settings.user_prompt ? "项目内已设置" : "当前为空"}</dd>
        </div>
      </dl>

      {error ? <p className="form-error">{error}</p> : null}
      <div className="new-job-panel__actions">
        <Button icon={<Settings2 size={14} />} onClick={() => navigate("/presets")}>
          管理预设
        </Button>
        <Button
          tone="primary"
          icon={actions.create.isPending ? <Spinner /> : <Play size={14} />}
          disabled={!ready || actions.create.isPending}
          onClick={() => void create()}
        >
          开始任务
        </Button>
      </div>
    </aside>
  );
}
