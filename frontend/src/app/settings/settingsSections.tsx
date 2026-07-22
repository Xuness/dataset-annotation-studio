import type { ComponentType } from "react";
import { BadgeInfo, Cable, Palette, type LucideIcon } from "lucide-react";

import { AppearanceSettings } from "../../shared/settings/sections/AppearanceSettings";
import {
  type SettingsSection,
  SETTINGS_SECTION_IDS,
} from "../../shared/settings/settingsSectionIds";
import { AboutSettings } from "./sections/AboutSettings";
import { PresetSettings } from "./sections/PresetSettings";

interface SettingsSectionDefinition {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  component: ComponentType<{ onClose: () => void }>;
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
