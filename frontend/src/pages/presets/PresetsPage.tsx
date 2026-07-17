import { useState } from "react";
import { ArrowLeft, Braces, Cable, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useUnsavedChangesGuard } from "../../shared/desktop/useUnsavedChanges";
import { Button } from "../../shared/ui/Button";
import { ProviderProfilesPanel } from "./components/ProviderProfilesPanel";
import { SystemPresetsPanel } from "./components/SystemPresetsPanel";
import "./presets.css";

type PresetTab = "system" | "providers";

export function PresetsPage() {
  const navigate = useNavigate();
  const { confirmDiscard } = useUnsavedChangesGuard();
  const [tab, setTab] = useState<PresetTab>("system");
  const [createSignal, setCreateSignal] = useState(0);

  function changeTab(nextTab: PresetTab) {
    if (nextTab === tab || confirmDiscard()) setTab(nextTab);
  }

  return (
    <main className="presets-page">
      <header className="presets-topbar">
        <div>
          <Button icon={<ArrowLeft size={15} />} onClick={() => confirmDiscard() && navigate(-1)}>
            返回
          </Button>
          <span>
            <strong>预设与连接</strong>
            <small>全局复用，任务会保存当时的完整快照</small>
          </span>
        </div>
        <Button
          tone="primary"
          icon={<Plus size={15} />}
          onClick={() => confirmDiscard() && setCreateSignal((n) => n + 1)}
        >
          新建{tab === "system" ? "预设" : "连接"}
        </Button>
      </header>
      <div className="presets-layout">
        <nav className="presets-navigation">
          <span className="eyebrow">Global library</span>
          <button
            className={tab === "system" ? "is-active" : ""}
            onClick={() => changeTab("system")}
          >
            <Braces size={16} />
            <span>
              <strong>System Prompt</strong>
              <small>全局标注指令</small>
            </span>
          </button>
          <button
            className={tab === "providers" ? "is-active" : ""}
            onClick={() => changeTab("providers")}
          >
            <Cable size={16} />
            <span>
              <strong>模型连接</strong>
              <small>API 或 Codex OAuth</small>
            </span>
          </button>
          <p>API Key 保存在系统凭据库；Codex OAuth 凭据由 Codex 自身管理，均不会写入数据集项目。</p>
        </nav>
        {tab === "system" ? (
          <SystemPresetsPanel createSignal={createSignal} />
        ) : (
          <ProviderProfilesPanel createSignal={createSignal} />
        )}
      </div>
    </main>
  );
}
