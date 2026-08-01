import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Braces, Cable, Languages, Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { resolvePresetTab, type PresetTab } from "../../../src/features/presets/navigation";
import { useLegacyUnsavedChangesGuard } from "../../legacy/hooks/useLegacyUnsavedChangesGuard";
import { Button } from "../../shared/ui/Button";
import { ProviderProfilesPanel } from "./components/ProviderProfilesPanel";
import { SystemPresetsPanel } from "./components/SystemPresetsPanel";
import { TranslationPromptsPanel } from "./components/TranslationPromptsPanel";
import "./presets.css";

export function PresetsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirmDiscard } = useLegacyUnsavedChangesGuard();
  const [tab, setTab] = useState<PresetTab>(() => resolvePresetTab(searchParams.get("tab")));
  const [createSignal, setCreateSignal] = useState(0);
  const handledCreateLocation = useRef<string | null>(null);

  useEffect(() => {
    if (searchParams.get("action") !== "create" || handledCreateLocation.current === location.key) {
      return;
    }
    handledCreateLocation.current = location.key;
    setCreateSignal((value) => value + 1);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("action");
    setSearchParams(nextSearchParams, { replace: true });
  }, [location.key, searchParams, setSearchParams]);

  function changeTab(nextTab: PresetTab) {
    if (nextTab === tab) return;
    void (async () => {
      if (!(await confirmDiscard())) return;
      setTab(nextTab);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("tab", nextTab);
      nextSearchParams.delete("action");
      setSearchParams(nextSearchParams, { replace: true });
    })();
  }

  function leavePage() {
    void (async () => {
      if (await confirmDiscard()) navigate(-1);
    })();
  }

  function requestCreate() {
    void (async () => {
      if (await confirmDiscard()) setCreateSignal((n) => n + 1);
    })();
  }

  return (
    <main className="presets-page">
      <header className="presets-topbar">
        <div>
          <Button icon={<ArrowLeft size={15} />} onClick={leavePage}>
            返回
          </Button>
          <span>
            <strong>预设与连接</strong>
            <small>全局复用，任务会保存当时的完整快照</small>
          </span>
        </div>
        <Button tone="primary" icon={<Plus size={15} />} onClick={requestCreate}>
          新建{tab === "providers" ? "连接" : "预设"}
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
            className={tab === "translation" ? "is-active" : ""}
            onClick={() => changeTab("translation")}
          >
            <Languages size={16} />
            <span>
              <strong>翻译 Prompt</strong>
              <small>译文 System Prompt</small>
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
          <p>
            Prompt 与连接均为全局配置；任务创建后保存完整快照。API Key
            保存在系统凭据库，不会写入数据集项目。
          </p>
        </nav>
        {tab === "system" ? <SystemPresetsPanel createSignal={createSignal} /> : null}
        {tab === "translation" ? <TranslationPromptsPanel createSignal={createSignal} /> : null}
        {tab === "providers" ? <ProviderProfilesPanel createSignal={createSignal} /> : null}
      </div>
    </main>
  );
}
