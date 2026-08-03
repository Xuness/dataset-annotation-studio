import type {
  PreparationCanvasNodeId,
  PreparationCapabilityId,
} from "../../../../../pages/spaces/spacePageModel";

export interface PreparationCapabilityPresentation {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly parameters: string;
}

export const PREPARATION_CAPABILITY_PRESENTATION = {
  geometry: {
    code: "GEOMETRY",
    title: "尺寸与几何",
    description: "建立素材的目标尺度与缩放策略。",
    parameters: "MAX EDGE / ALGORITHM / UPSCALE",
  },
  encoding: {
    code: "ENCODING",
    title: "格式与编码",
    description: "统一交付格式、质量与压缩行为。",
    parameters: "FORMAT / QUALITY / EFFORT",
  },
  identity: {
    code: "IDENTITY",
    title: "文件与身份",
    description: "规范文件名，并保持标注与旁车同步。",
    parameters: "TEMPLATE / INDEX / SIDECAR",
  },
} as const satisfies Readonly<Record<PreparationCapabilityId, PreparationCapabilityPresentation>>;

interface PreparationNodePresentation {
  readonly canvasCode: string;
  readonly canvasTitle: string;
  readonly inspectorCode: string;
  readonly inspectorTitle: string;
}

export const PREPARATION_NODE_PRESENTATION = {
  source: {
    canvasCode: "SRC / 00",
    canvasTitle: "项目源版本",
    inspectorCode: "SOURCE",
    inspectorTitle: "项目源版本",
  },
  scope: {
    canvasCode: "SCP / 01",
    canvasTitle: "处理范围",
    inspectorCode: "SCOPE GATE",
    inspectorTitle: "处理范围",
  },
  geometry: {
    canvasCode: PREPARATION_CAPABILITY_PRESENTATION.geometry.code,
    canvasTitle: PREPARATION_CAPABILITY_PRESENTATION.geometry.title,
    inspectorCode: PREPARATION_CAPABILITY_PRESENTATION.geometry.code,
    inspectorTitle: PREPARATION_CAPABILITY_PRESENTATION.geometry.title,
  },
  encoding: {
    canvasCode: PREPARATION_CAPABILITY_PRESENTATION.encoding.code,
    canvasTitle: PREPARATION_CAPABILITY_PRESENTATION.encoding.title,
    inspectorCode: PREPARATION_CAPABILITY_PRESENTATION.encoding.code,
    inspectorTitle: PREPARATION_CAPABILITY_PRESENTATION.encoding.title,
  },
  identity: {
    canvasCode: PREPARATION_CAPABILITY_PRESENTATION.identity.code,
    canvasTitle: PREPARATION_CAPABILITY_PRESENTATION.identity.title,
    inspectorCode: PREPARATION_CAPABILITY_PRESENTATION.identity.code,
    inspectorTitle: PREPARATION_CAPABILITY_PRESENTATION.identity.title,
  },
  preview: {
    canvasCode: "PRV / 05",
    canvasTitle: "方案预演",
    inspectorCode: "PREVIEW",
    inspectorTitle: "方案预演",
  },
  commit: {
    canvasCode: "CMT / 06",
    canvasTitle: "提交与执行",
    inspectorCode: "COMMIT",
    inspectorTitle: "执行与结果",
  },
  recovery: {
    canvasCode: "RCV / 07",
    canvasTitle: "恢复与追溯",
    inspectorCode: "RECOVERY",
    inspectorTitle: "追溯与恢复",
  },
} as const satisfies Readonly<Record<PreparationCanvasNodeId, PreparationNodePresentation>>;
