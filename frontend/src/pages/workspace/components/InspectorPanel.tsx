import { useEffect } from "react";
import { Braces, ChartNoAxesColumn, MessageSquareText } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
import { useUnsavedChangesStore } from "../../../shared/store/unsavedChangesStore";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { inspectorViewState, type InspectorTab } from "../workspaceViewState";
import { MetadataSettingsPanel } from "./MetadataSettingsPanel";
import { OverviewPanel } from "./OverviewPanel";
import { PromptSettingsPanel } from "./PromptSettingsPanel";

interface InspectorPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
  onDeleteAsset: (assetId: string) => void;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof ChartNoAxesColumn }> = [
  { id: "overview", label: "总览", icon: ChartNoAxesColumn },
  { id: "prompt", label: "提示词", icon: MessageSquareText },
  { id: "metadata", label: "元数据", icon: Braces },
];

export function InspectorPanel({
  projectId,
  workspace,
  asset,
  onDeleteAsset,
}: InspectorPanelProps) {
  const [searchParams] = useSearchParams();
  const { activeTab } = inspectorViewState.useValue(projectId);
  const setActiveTab = (tab: InspectorTab) =>
    inspectorViewState.patch(projectId, { activeTab: tab });
  const promptPanelRequested = searchParams.get("panel") === "prompt";
  useEffect(() => {
    if (promptPanelRequested) inspectorViewState.patch(projectId, { activeTab: "prompt" });
  }, [projectId, promptPanelRequested]);
  const promptScope = `workspace-prompt:${projectId}`;
  const promptDirty = useUnsavedChangesStore((state) => Boolean(state.dirtyScopes[promptScope]));
  const setDirtyScope = useUnsavedChangesStore((state) => state.setDirtyScope);

  function selectTab(tab: InspectorTab) {
    if (tab === activeTab) return;
    if (activeTab !== "prompt" || !promptDirty) {
      setActiveTab(tab);
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog("项目提示词配置尚未保存，离开这个面板会丢弃修改。", {
        title: "尚未保存",
        tone: "danger",
        confirmLabel: "丢弃修改",
        cancelLabel: "继续编辑",
      });
      if (!confirmed) return;
      setDirtyScope(promptScope, false);
      setActiveTab(tab);
    })();
  }

  return (
    <aside className="inspector-panel" data-surface-region="secondary-sidebar">
      <div className="inspector-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={activeTab === id ? "is-active" : ""}
            onClick={() => selectTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <div className="inspector-panel__content">
        {activeTab === "overview" ? (
          <OverviewPanel
            projectId={projectId}
            workspace={workspace}
            asset={asset}
            onDeleteAsset={onDeleteAsset}
          />
        ) : null}
        {activeTab === "prompt" ? (
          <PromptSettingsPanel projectId={projectId} workspace={workspace} asset={asset} />
        ) : null}
        {activeTab === "metadata" ? (
          <MetadataSettingsPanel projectId={projectId} workspace={workspace} asset={asset} />
        ) : null}
      </div>
    </aside>
  );
}
