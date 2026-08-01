import { useEffect, useMemo, useState } from "react";
import { Check, FileJson2 } from "lucide-react";

import { useAssetMetadata } from "../../../../src/features/assets/hooks";
import { useUpdateWorkspace } from "../../../../src/features/workspaces/hooks";
import type { AssetSummary, WorkspaceSummary } from "../../../../src/shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";

interface MetadataSettingsPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
}

export function MetadataSettingsPanel({ projectId, workspace, asset }: MetadataSettingsPanelProps) {
  const metadata = useAssetMetadata(projectId, asset?.id ?? null);
  const update = useUpdateWorkspace(projectId);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => new Set(workspace.settings.json_fields),
    [workspace.settings.json_fields],
  );

  useEffect(() => setError(null), [asset?.id]);

  async function toggleField(field: string) {
    const next = new Set(selected);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setError(null);
    try {
      await update.mutateAsync({ json_fields: [...next] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存元数据字段失败。");
    }
  }

  if (!asset)
    return (
      <div className="inspector-empty">
        <FileJson2 size={22} />
        <p>选择图片后查看同名 JSON。</p>
      </div>
    );
  if (metadata.isLoading)
    return (
      <div className="inspector-empty">
        <Spinner />
      </div>
    );
  if (metadata.isError && !metadata.data)
    return (
      <div className="inspector-empty inspector-empty--error">
        <p>{metadata.error instanceof Error ? metadata.error.message : "读取 JSON 失败。"}</p>
      </div>
    );
  if (!metadata.data?.exists)
    return (
      <div className="inspector-empty">
        <FileJson2 size={22} />
        <p>这张图片没有同名 JSON；它仍可正常参与标注。</p>
      </div>
    );
  if (metadata.data.error)
    return (
      <div className="inspector-empty inspector-empty--error">
        <p>{metadata.data.error}</p>
      </div>
    );

  return (
    <>
      <section className="inspector-section">
        <span className="section-kicker">追加到 User Prompt</span>
        <p className="quiet-copy">选中的键会以“键名: 值”形式逐行追加。</p>
        <div className="metadata-fields">
          {metadata.data.fields.map((field) => (
            <button
              key={field}
              className={selected.has(field) ? "is-selected" : ""}
              onClick={() => void toggleField(field)}
              disabled={update.isPending}
            >
              <span>{selected.has(field) ? <Check size={12} /> : null}</span>
              {field}
            </button>
          ))}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <section className="inspector-section inspector-section--grow">
        <span className="section-kicker">原始 JSON</span>
        <pre className="json-preview">{JSON.stringify(metadata.data.value, null, 2)}</pre>
      </section>
    </>
  );
}
