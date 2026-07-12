import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import { usePromptPreview } from "../../../features/assets/hooks";
import { useUpdateWorkspace } from "../../../features/workspaces/hooks";
import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

interface PromptSettingsPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
}

export function PromptSettingsPanel({ projectId, workspace, asset }: PromptSettingsPanelProps) {
  const [prompt, setPrompt] = useState(workspace.settings.user_prompt);
  const update = useUpdateWorkspace(projectId);
  const preview = usePromptPreview(projectId, asset?.id ?? null);

  useEffect(() => setPrompt(workspace.settings.user_prompt), [workspace.settings.user_prompt]);
  const dirty = prompt !== workspace.settings.user_prompt;

  async function savePrompt() {
    await update.mutateAsync({ user_prompt: prompt });
  }

  return (
    <>
      <section className="inspector-section">
        <div className="section-heading-row">
          <span className="section-kicker">项目 User Prompt</span>
          {dirty ? <span className="unsaved-mark">尚未保存</span> : null}
        </div>
        <textarea
          className="prompt-textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="输入在当前项目中保持稳定的 User Prompt…"
        />
        <Button
          tone="primary"
          icon={update.isPending ? <Spinner /> : <Save size={14} />}
          onClick={() => void savePrompt()}
          disabled={!dirty || update.isPending}
        >
          保存项目 Prompt
        </Button>
      </section>
      <section className="inspector-section inspector-section--grow">
        <span className="section-kicker">当前图片最终预览</span>
        {asset ? (
          <pre className="prompt-preview">
            {preview.data?.final_prompt || "保存 Prompt 后，此处会显示拼接元数据的最终内容。"}
          </pre>
        ) : (
          <p className="quiet-copy">选择图片后预览最终发送内容。</p>
        )}
      </section>
    </>
  );
}
