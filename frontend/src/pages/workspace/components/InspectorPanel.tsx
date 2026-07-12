import { useState } from "react";
import { Braces, ChartNoAxesColumn, MessageSquareText } from "lucide-react";

import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
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
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={activeTab === id ? "is-active" : ""}
            onClick={() => setActiveTab(id)}
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
