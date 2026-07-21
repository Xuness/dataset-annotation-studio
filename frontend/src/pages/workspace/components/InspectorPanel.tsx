import { useState } from "react";
import { Braces, ChartNoAxesColumn, MessageSquareText } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
import { useAppStore } from "../../../shared/store/appStore";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { MetadataSettingsPanel } from "./MetadataSettingsPanel";
import { OverviewPanel } from "./OverviewPanel";
import { PromptSettingsPanel } from "./PromptSettingsPanel";

type InspectorTab = "overview" | "prompt" | "metadata";

interface InspectorPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof ChartNoAxesColumn }> = [
  { id: "overview", label: "总览", icon: ChartNoAxesColumn },
  { id: "prompt", label: "提示词", icon: MessageSquareText },
  { id: "metadata", label: "元数据", icon: Braces },
];

export function InspectorPanel({ projectId, workspace, asset }: InspectorPanelProps) {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<InspectorTab>(() =>
    searchParams.get("panel") === "prompt" ? "prompt" : "overview",
  );
  const promptScope = `workspace-prompt:${projectId}`;
  const promptDirty = useAppStore((state) => Boolean(state.dirtyScopes[promptScope]));
  const setDirtyScope = useAppStore((state) => state.setDirtyScope);

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
          <OverviewPanel projectId={projectId} workspace={workspace} asset={asset} />
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
