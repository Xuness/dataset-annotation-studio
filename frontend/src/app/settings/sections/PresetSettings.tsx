import type { LucideIcon } from "lucide-react";
import { Braces, Cable, Languages, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  useProviderProfiles,
  useSystemPresets,
  useTranslationPromptPresets,
} from "../../../features/presets/hooks";
import { buildPresetLibraryPath, type PresetTab } from "../../../features/presets/navigation";
import { SettingsSectionHeader } from "../../../shared/settings/components/SettingsSectionHeader";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

interface PresetResourceCardProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  summary: string;
  description: string;
  names: string[];
  loading: boolean;
  failed: boolean;
  onManage: () => void;
  onCreate: () => void;
}

function PresetResourceCard({
  icon: Icon,
  eyebrow,
  title,
  summary,
  description,
  names,
  loading,
  failed,
  onManage,
  onCreate,
}: PresetResourceCardProps) {
  return (
    <article className={`preset-summary-card ${failed ? "is-error" : ""}`.trim()}>
      <header>
        <span className="preset-summary-card__icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        {loading ? <Spinner label={`正在读取${title}`} /> : null}
      </header>

      <strong className="preset-summary-card__summary">{failed ? "暂时无法读取" : summary}</strong>
      <p>{failed ? "本地服务没有返回这组资源，可以稍后刷新或直接进入管理页。" : description}</p>

      <div className="preset-summary-card__names" aria-label={`${title}摘要`}>
        {names.length ? names.map((name) => <span key={name}>{name}</span>) : <span>尚无内容</span>}
      </div>

      <footer>
        <Button aria-label={`管理${title}`} onClick={onManage}>
          管理
        </Button>
        <Button tone="primary" aria-label={`新建${title}`} onClick={onCreate}>
          新建
        </Button>
      </footer>
    </article>
  );
}

export function PresetSettings({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const systemPresets = useSystemPresets();
  const translationPrompts = useTranslationPromptPresets();
  const providerProfiles = useProviderProfiles();
  const profiles = providerProfiles.data ?? [];
  const modelCount = profiles.reduce((total, profile) => total + profile.models.length, 0);
  const savedCredentialCount = profiles.filter((profile) => profile.has_api_key).length;
  const refreshing =
    systemPresets.isFetching || translationPrompts.isFetching || providerProfiles.isFetching;

  function openLibrary(tab: PresetTab, create = false) {
    onClose();
    navigate(buildPresetLibraryPath(tab, create));
  }

  function refresh() {
    void Promise.all([
      systemPresets.refetch(),
      translationPrompts.refetch(),
      providerProfiles.refetch(),
    ]);
  }

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Global library"
        title="预设与连接"
        description="查看全局 Prompt 与模型连接的状态；完整编辑仍在独立资料库中进行。"
        actions={
          <Button
            icon={refreshing ? <Spinner /> : <RefreshCw size={14} />}
            disabled={refreshing}
            onClick={refresh}
          >
            刷新
          </Button>
        }
        onClose={onClose}
      />

      <div className="preset-settings">
        <div className="preset-summary-grid">
          <PresetResourceCard
            icon={Braces}
            eyebrow="Annotation"
            title="System Prompt"
            summary={`${systemPresets.data?.length ?? 0} 套预设`}
            description="为标注任务提供稳定、可复用的完整系统指令。"
            names={(systemPresets.data ?? []).slice(0, 3).map((preset) => preset.name)}
            loading={systemPresets.isLoading}
            failed={systemPresets.isError}
            onManage={() => openLibrary("system")}
            onCreate={() => openLibrary("system", true)}
          />
          <PresetResourceCard
            icon={Languages}
            eyebrow="Translation"
            title="翻译 Prompt"
            summary={`${translationPrompts.data?.length ?? 0} 套预设`}
            description="为不同目标语言保存一致的翻译规则与输出约束。"
            names={(translationPrompts.data ?? []).slice(0, 3).map((preset) => preset.name)}
            loading={translationPrompts.isLoading}
            failed={translationPrompts.isError}
            onManage={() => openLibrary("translation")}
            onCreate={() => openLibrary("translation", true)}
          />
          <PresetResourceCard
            icon={Cable}
            eyebrow="Providers"
            title="模型连接"
            summary={`${profiles.length} 个连接 · ${modelCount} 个模型`}
            description={`${savedCredentialCount} 个 API Key 已安全保存；Codex OAuth 独立管理。`}
            names={profiles.slice(0, 3).map((profile) => profile.name)}
            loading={providerProfiles.isLoading}
            failed={providerProfiles.isError}
            onManage={() => openLibrary("providers")}
            onCreate={() => openLibrary("providers", true)}
          />
        </div>
      </div>

      <footer>
        <span>Prompt 与连接在所有数据集间复用</span>
        <span>任务创建后保存完整配置快照</span>
      </footer>
    </>
  );
}
