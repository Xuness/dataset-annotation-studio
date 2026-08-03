import type {
  AnnotationContextSignalId,
  AnnotationLaneId,
} from "../../../../../pages/spaces/spacePageModel";

interface AnnotationLanePresentation {
  code: string;
  title: string;
  englishTitle: string;
  description: string;
  manualAction: string;
  automaticAction: string;
}

export const ANNOTATION_LANE_PRESENTATION: Readonly<
  Record<AnnotationLaneId, AnnotationLanePresentation>
> = {
  tags: {
    code: "TAG",
    title: "标签",
    englishTitle: "TAGS",
    description: "以本地 Tagger 或人工编辑建立结构化标签通道。",
    manualAction: "编辑 Tags",
    automaticAction: "建立 Tagger 线路",
  },
  description: {
    code: "DSC",
    title: "描述",
    englishTitle: "DESCRIPTION",
    description: "结合图片、项目提示词与元数据生产可追溯的视觉描述。",
    manualAction: "编辑描述",
    automaticAction: "建立描述线路",
  },
  translation: {
    code: "TRN",
    title: "译文",
    englishTitle: "TRANSLATION",
    description: "按语言、源通道和生成方式保存彼此独立的译文身份。",
    manualAction: "检查译文",
    automaticAction: "建立翻译线路",
  },
};

export const ANNOTATION_CONTEXT_PRESENTATION: Readonly<
  Record<
    AnnotationContextSignalId,
    { code: string; label: string; group: "project" | "capability" }
  >
> = {
  "system-prompt": { code: "SYS", label: "系统提示词", group: "project" },
  "user-context": { code: "USR", label: "项目说明", group: "project" },
  "tags-context": { code: "TAG", label: "Tags 上下文", group: "project" },
  "json-fields": { code: "JSN", label: "元数据字段", group: "project" },
  provider: { code: "LLM", label: "模型服务", group: "capability" },
  tagger: { code: "LOC", label: "本地 Tagger", group: "capability" },
  "translation-prompt": { code: "TRP", label: "翻译提示词", group: "capability" },
  dictionary: { code: "DIC", label: "本地词典", group: "capability" },
};
