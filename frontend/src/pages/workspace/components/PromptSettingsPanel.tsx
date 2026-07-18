import { useEffect, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { usePromptPreview } from "../../../features/assets/hooks";
import { useSystemPresets } from "../../../features/presets/hooks";
import { useUpdateWorkspace } from "../../../features/workspaces/hooks";
import { useUnsavedScope } from "../../../shared/desktop/useUnsavedChanges";
import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";

interface PromptSettingsPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
}

export function PromptSettingsPanel({ projectId, workspace, asset }: PromptSettingsPanelProps) {
  const navigate = useNavigate();
  const systemPresets = useSystemPresets();
  const [systemPresetId, setSystemPresetId] = useState(workspace.settings.system_preset_id ?? "");
  const [prompt, setPrompt] = useState(workspace.settings.user_prompt);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateWorkspace(projectId);
  const preview = usePromptPreview(projectId, asset?.id ?? null);

  useEffect(() => {
    setSystemPresetId(workspace.settings.system_preset_id ?? "");
    setPrompt(workspace.settings.user_prompt);
  }, [workspace.settings.system_preset_id, workspace.settings.user_prompt]);
  const dirty =
    systemPresetId !== (workspace.settings.system_preset_id ?? "") ||
    prompt !== workspace.settings.user_prompt;
  useUnsavedScope(`workspace-prompt:${projectId}`, dirty);

  const selectedPresetExists = Boolean(
    systemPresets.data?.some((preset) => preset.id === systemPresetId),
  );
  const savedPresetMissing = Boolean(
    systemPresets.isSuccess &&
    workspace.settings.system_preset_id &&
    !systemPresets.data.some((preset) => preset.id === workspace.settings.system_preset_id),
  );

  function openPresetLibrary() {
    void (async () => {
      if (dirty) {
        const confirmed = await confirmDialog("项目提示词配置尚未保存，前往全局预设会丢弃修改。", {
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃并前往",
          cancelLabel: "继续编辑",
        });
        if (!confirmed) return;
      }
      navigate("/presets");
    })();
  }

  async function savePrompt() {
    setError(null);
    if (!systemPresetId || !selectedPresetExists) {
      setError("请先选择一个有效的 System Prompt 预设。");
      return;
    }
    try {
      await update.mutateAsync({ system_preset_id: systemPresetId, user_prompt: prompt });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存项目提示词配置失败。");
    }
  }

  return (
    <>
      <section className="inspector-section">
        <div className="section-heading-row">
          <span className="section-kicker">项目提示词配置</span>
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>
        <label className="form-field prompt-preset-field">
          <span>System Prompt 预设</span>
          <select
            value={systemPresetId}
            disabled={systemPresets.isLoading || !systemPresets.data?.length}
            onChange={(event) => setSystemPresetId(event.target.value)}
          >
            <option value="">
              {systemPresets.isLoading
                ? "正在读取预设…"
                : systemPresets.data?.length
                  ? "请选择项目使用的预设"
                  : "尚未创建 System Prompt 预设"}
            </option>
            {systemPresets.isSuccess && systemPresetId && !selectedPresetExists ? (
              <option value={systemPresetId}>原预设已不存在</option>
            ) : null}
            {systemPresets.data?.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        {savedPresetMissing ? (
          <p className="prompt-config-warning">原先关联的全局预设已不存在，请重新选择。</p>
        ) : null}
        {systemPresets.isError ? (
          <p className="form-error">
            {systemPresets.error instanceof Error
              ? systemPresets.error.message
              : "读取 System Prompt 预设失败。"}
          </p>
        ) : null}
        <label className="prompt-user-field">
          <span>项目 User Prompt</span>
          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入在当前项目中保持稳定的 User Prompt…"
          />
        </label>
        <div className="prompt-config-actions">
          <Button icon={<Settings2 size={14} />} onClick={openPresetLibrary}>
            管理全局预设
          </Button>
          <Button
            tone="primary"
            icon={update.isPending ? <Spinner /> : <Save size={14} />}
            onClick={() => void savePrompt()}
            disabled={!dirty || update.isPending || !systemPresetId || !selectedPresetExists}
          >
            保存项目配置
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <section className="inspector-section inspector-section--grow">
        <div className="section-heading-row">
          <span className="section-kicker">当前图片最终请求</span>
          <span className="prompt-request-badge">SYSTEM + USER + IMAGE</span>
        </div>
        {dirty ? <p className="quiet-copy">下方预览仍以最后保存的项目配置为准。</p> : null}
        {asset ? (
          preview.isError ? (
            <p className="form-error">
              {preview.error instanceof Error ? preview.error.message : "读取最终 Prompt 失败。"}
            </p>
          ) : preview.data ? (
            <div className="prompt-request-preview">
              {preview.data.configuration_issue ? (
                <p className="prompt-config-warning">{preview.data.configuration_issue}</p>
              ) : null}
              <article className="prompt-message-card">
                <header>
                  <span>SYSTEM</span>
                  <small>{preview.data.system_preset_name ?? "未配置预设"}</small>
                </header>
                <pre>{preview.data.system_prompt || "尚未保存 System Prompt 预设。"}</pre>
              </article>
              <article className="prompt-message-card">
                <header>
                  <span>USER</span>
                  <small>
                    {preview.data.metadata_lines.length
                      ? `项目内容 + ${preview.data.metadata_lines.length} 行元数据`
                      : "项目内容"}
                  </small>
                </header>
                <pre>{preview.data.final_user_prompt || "User Prompt 当前为空。"}</pre>
              </article>
              <p className="prompt-image-note">当前图片会与 USER 消息一起发送给多模态模型。</p>
            </div>
          ) : (
            <Spinner label="拼装最终请求" />
          )
        ) : (
          <p className="quiet-copy">选择图片后预览最终发送内容。</p>
        )}
      </section>
    </>
  );
}
