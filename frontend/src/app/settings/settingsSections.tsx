import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { BadgeInfo, Cable, Palette, type LucideIcon } from "lucide-react";

import {
  type SettingsSection,
  SETTINGS_SECTION_IDS,
} from "../../shared/settings/settingsSectionIds";

const AppearanceSettings = lazy(async () => {
  const module = await import("../../shared/settings/sections/AppearanceSettings");
  return { default: module.AppearanceSettings };
});

const PresetSettings = lazy(async () => {
  const module = await import("./sections/PresetSettings");
  return { default: module.PresetSettings };
});

const AboutSettings = lazy(async () => {
  const module = await import("./sections/AboutSettings");
  return { default: module.AboutSettings };
});

type SettingsSectionComponent = LazyExoticComponent<ComponentType<{ onClose: () => void }>>;

interface SettingsSectionDefinition {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  component: SettingsSectionComponent;
  sidebarNote: string;
}

const sectionDefinitions = {
  appearance: {
    id: "appearance",
    label: "外观与主题",
    icon: Palette,
    component: AppearanceSettings,
    sidebarNote: "外观设置仅保存在此设备，不会写入数据集项目。",
  },
  presets: {
    id: "presets",
    label: "预设与连接",
    icon: Cable,
    component: PresetSettings,
    sidebarNote: "Prompt 与模型连接作为全局资源复用；API Key 保存在系统凭据库。",
  },
  about: {
    id: "about",
    label: "关于与诊断",
    icon: BadgeInfo,
    component: AboutSettings,
    sidebarNote: "诊断信息来自本机运行状态，不会读取数据集内容或私密凭据。",
  },
} satisfies Record<SettingsSection, SettingsSectionDefinition>;

export const SETTINGS_SECTIONS = SETTINGS_SECTION_IDS.map((id) => sectionDefinitions[id]);
