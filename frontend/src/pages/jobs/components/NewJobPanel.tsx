import { useEffect, useState } from "react";
import { Bot, Languages, Play, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useJobActions } from "../../../features/jobs/hooks";
import {
  useProviderProfiles,
  useSystemPresets,
  useTranslationPromptPresets,
} from "../../../features/presets/hooks";
import type {
  ExistingTranslationPolicy,
  JobDetail,
  JobKind,
  WorkspaceSummary,
} from "../../../shared/api/types";
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
  const translationPromptPresets = useTranslationPromptPresets();
  const providerProfiles = useProviderProfiles();
  const actions = useJobActions(projectId);
  const [kind, setKind] = useState<JobKind>("annotation");
  const [providerProfileId, setProviderProfileId] = useState("");
  const [providerModelId, setProviderModelId] = useState("");
  const [translationPromptPresetId, setTranslationPromptPresetId] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [translationPolicy, setTranslationPolicy] = useState<ExistingTranslationPolicy>("skip");
  const [error, setError] = useState<string | null>(null);
  const selectedProvider = providerProfiles.data?.find(
    (profile) => profile.id === providerProfileId,
  );

  useEffect(() => {
    const available = providerProfiles.data;
    if (!available?.length) {
      if (providerProfileId) setProviderProfileId("");
      return;
    }
    if (!available.some((profile) => profile.id === providerProfileId)) {
      setProviderProfileId(available[0].id);
    }
  }, [providerProfileId, providerProfiles.data]);

  useEffect(() => {
    if (!selectedProvider) {
      if (providerModelId) setProviderModelId("");
      return;
    }
    if (!selectedProvider.models.some((model) => model.model_id === providerModelId)) {
      setProviderModelId(selectedProvider.default_model_id);
    }
  }, [providerModelId, selectedProvider]);

  useEffect(() => {
    const available = translationPromptPresets.data;
    if (!available?.length) {
      if (translationPromptPresetId) setTranslationPromptPresetId("");
      return;
    }
    if (!available.some((preset) => preset.id === translationPromptPresetId)) {
      setTranslationPromptPresetId(available[0].id);
    }
  }, [translationPromptPresetId, translationPromptPresets.data]);

  async function create() {
    setError(null);
    try {
      const job = await actions.create.mutateAsync({
        provider_profile_id: providerProfileId,
        model_id: providerModelId,
        kind,
        scope,
        asset_ids: scope === "selected" ? checkedAssetIds : [],
        translation_prompt_preset_id:
          kind === "translation" ? translationPromptPresetId : undefined,
        target_language: targetLanguage,
        translation_policy: translationPolicy,
      });
      onCreated(job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建任务。");
    }
  }

  const configuredSystemPreset = systemPresets.data?.find(
    (preset) => preset.id === workspace.settings.system_preset_id,
  );
  const promptConfigurationIssue = !workspace.settings.system_preset_id
    ? "尚未在素材页选择 System Prompt 预设"
    : systemPresets.isError
      ? "无法读取项目关联的 System Prompt 预设"
      : systemPresets.isSuccess && !configuredSystemPreset
        ? "项目关联的 System Prompt 预设已不存在"
        : null;
  const configuredTranslationPrompt = translationPromptPresets.data?.find(
    (preset) => preset.id === translationPromptPresetId,
  );
  const translationPromptIssue = translationPromptPresets.isError
    ? "无法读取翻译 Prompt 预设"
    : translationPromptPresets.isSuccess && !configuredTranslationPrompt
      ? "尚未创建可用的翻译 Prompt 预设"
      : null;
  const ready = Boolean(
    (kind === "translation" ? configuredTranslationPrompt : configuredSystemPreset) &&
    selectedProvider &&
    selectedProvider.models.some((model) => model.model_id === providerModelId) &&
    (scope === "all" || checkedAssetIds.length > 0),
  );

  return (
    <aside className="new-job-panel" data-surface-region="primary-sidebar">
      <header>
        <span className="new-job-icon">
          {kind === "annotation" ? <Bot size={18} /> : <Languages size={18} />}
        </span>
        <div>
          <span className="eyebrow">New processing run</span>
          <h2>创建任务</h2>
        </div>
      </header>

      <div className="job-kind-switch" aria-label="任务类型">
        <button
          className={kind === "annotation" ? "is-active" : ""}
          onClick={() => setKind("annotation")}
        >
          <Bot size={14} /> 标注
        </button>
        <button
          className={kind === "translation" ? "is-active" : ""}
          onClick={() => setKind("translation")}
        >
          <Languages size={14} /> 翻译
        </button>
      </div>

      {kind === "annotation" ? (
        <div className={`job-prompt-source ${promptConfigurationIssue ? "has-error" : ""}`}>
          <span>项目提示词</span>
          <strong>
            {systemPresets.isLoading
              ? "正在读取项目配置…"
              : (configuredSystemPreset?.name ?? promptConfigurationIssue)}
          </strong>
          <small>System Prompt 与 User Prompt 均沿用素材页最后保存的配置。</small>
          {promptConfigurationIssue ? (
            <button onClick={() => navigate(`/workspace/${projectId}?panel=prompt`)}>
              回到素材页配置
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <label className="form-field">
            <span>翻译 Prompt 预设</span>
            <select
              value={translationPromptPresetId}
              onChange={(event) => setTranslationPromptPresetId(event.target.value)}
            >
              {!translationPromptPresets.data?.length ? (
                <option value="">尚未创建翻译 Prompt 预设</option>
              ) : null}
              {translationPromptPresets.data?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div className={`job-prompt-source ${translationPromptIssue ? "has-error" : ""}`}>
            <span>任务快照</span>
            <strong>
              {translationPromptPresets.isLoading
                ? "正在读取翻译 Prompt…"
                : (configuredTranslationPrompt?.name ?? translationPromptIssue)}
            </strong>
            <small>目标语言变量会在创建任务时展开；后续修改预设不会影响本次任务。</small>
            {translationPromptIssue ? (
              <button onClick={() => navigate("/presets?tab=translation")}>
                前往创建翻译 Prompt
              </button>
            ) : null}
          </div>
        </>
      )}

      <label className="form-field">
        <span>模型连接</span>
        <select
          value={providerProfileId}
          onChange={(event) => setProviderProfileId(event.target.value)}
        >
          {!providerProfiles.data?.length ? <option value="">尚未创建模型连接</option> : null}
          {providerProfiles.data?.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.models.length} 个模型
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>任务模型</span>
        <select
          value={providerModelId}
          disabled={!selectedProvider}
          onChange={(event) => setProviderModelId(event.target.value)}
        >
          {!selectedProvider ? <option value="">请先选择模型连接</option> : null}
          {selectedProvider?.models.map((model) => (
            <option key={model.model_id} value={model.model_id}>
              {model.model_id}
              {model.model_id === selectedProvider.default_model_id ? " · 默认" : ""}
            </option>
          ))}
        </select>
        <small>本次任务会固定模型及其参数；之后修改连接、默认模型或参数不会影响任务快照。</small>
      </label>

      {kind === "translation" ? (
        <>
          <label className="form-field">
            <span>目标语言</span>
            <select
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            >
              <option value="zh-CN">简体中文 · zh-CN</option>
              <option value="zh-TW">繁體中文 · zh-TW</option>
              <option value="en">English · en</option>
              <option value="ja">日本語 · ja</option>
              <option value="ko">한국어 · ko</option>
            </select>
          </label>
          <label className="form-field">
            <span>已有译文</span>
            <select
              value={translationPolicy}
              onChange={(event) =>
                setTranslationPolicy(event.target.value as ExistingTranslationPolicy)
              }
            >
              <option value="skip">跳过已有译文</option>
              <option value="stale">补齐缺失并重译过期项</option>
              <option value="overwrite">覆盖范围内全部译文</option>
            </select>
          </label>
        </>
      ) : null}

      <div className="job-scope">
        <span>处理范围</span>
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          {kind === "annotation" ? "全部未标注" : "全部有源标注"}
          <small>
            {kind === "annotation"
              ? Math.max(workspace.asset_count - workspace.annotated_count, 0)
              : workspace.annotated_count}
          </small>
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
          <dt>{kind === "annotation" ? "已有 TXT" : "文件命名"}</dt>
          <dd>{kind === "annotation" ? "自动跳过" : `*.${targetLanguage}.txt`}</dd>
        </div>
        <div>
          <dt>失败重试</dt>
          <dd>首次 + 3 次</dd>
        </div>
        <div>
          <dt>输出处理</dt>
          <dd>{kind === "annotation" ? "原样写入" : "标签结构校验"}</dd>
        </div>
        <div>
          <dt>{kind === "annotation" ? "User Prompt" : "源标注"}</dt>
          <dd>
            {kind === "annotation"
              ? workspace.settings.user_prompt
                ? "项目内已设置"
                : "当前为空"
              : "只读读取同名 TXT"}
          </dd>
        </div>
      </dl>

      {error ? <p className="form-error">{error}</p> : null}
      <div className="new-job-panel__actions">
        <Button
          icon={<Settings2 size={14} />}
          onClick={() => navigate(kind === "translation" ? "/presets?tab=translation" : "/presets")}
        >
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
