export type HomeSpaceId =
  "archive" | "preparation" | "annotation" | "quality" | "delivery" | "capability";

export type HomeSpaceLane = "primary" | "support";

export interface HomeSpace {
  id: HomeSpaceId;
  index: string;
  label: string;
  englishLabel: string;
  shortLabel: string;
  description: string;
  route: string;
  lane: HomeSpaceLane;
}

export const HOME_SPACES: readonly HomeSpace[] = [
  {
    id: "archive",
    index: "01",
    label: "项目档案",
    englishLabel: "Project Archive",
    shortLabel: "档案",
    description: "接入、组织并管理数据集、项目与素材。",
    route: "/archive",
    lane: "primary",
  },
  {
    id: "preparation",
    index: "02",
    label: "数据整备",
    englishLabel: "Preparation",
    shortLabel: "整备",
    description: "在标注前完成可预览、可恢复的数据处理。",
    route: "/preparation",
    lane: "primary",
  },
  {
    id: "annotation",
    index: "03",
    label: "标注生产",
    englishLabel: "Annotation",
    shortLabel: "标注",
    description: "生成、编辑并翻译多通道标注内容。",
    route: "/annotation",
    lane: "primary",
  },
  {
    id: "quality",
    index: "04",
    label: "质量控制",
    englishLabel: "Quality Control",
    shortLabel: "质控",
    description: "复核内容完整性、可靠性与交付质量。",
    route: "/quality",
    lane: "primary",
  },
  {
    id: "delivery",
    index: "05",
    label: "发布交付",
    englishLabel: "Delivery",
    shortLabel: "交付",
    description: "冻结修订并规划、输出可交付的数据集。",
    route: "/delivery",
    lane: "support",
  },
  {
    id: "capability",
    index: "06",
    label: "能力库",
    englishLabel: "Capability Library",
    shortLabel: "能力",
    description: "管理模型、词典、预设与共享生产能力。",
    route: "/capability",
    lane: "support",
  },
] as const;

export const PRIMARY_HOME_SPACES = HOME_SPACES.filter((space) => space.lane === "primary");
export const SUPPORT_HOME_SPACES = HOME_SPACES.filter((space) => space.lane === "support");

export function getHomeSpace(id: HomeSpaceId): HomeSpace {
  const space = HOME_SPACES.find((candidate) => candidate.id === id);
  if (!space) throw new Error(`Unknown home space: ${id}`);
  return space;
}

export function getAdjacentHomeSpace(id: HomeSpaceId, delta: number): HomeSpaceId {
  const index = HOME_SPACES.findIndex((space) => space.id === id);
  const nextIndex = (index + delta + HOME_SPACES.length) % HOME_SPACES.length;
  return HOME_SPACES[nextIndex].id;
}
