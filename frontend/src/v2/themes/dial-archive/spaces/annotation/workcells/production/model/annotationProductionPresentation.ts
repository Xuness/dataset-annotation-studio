import type { AnnotationLaneId } from "../../../../../../../pages/spaces/spacePageModel";

interface ProductionLanePresentation {
  readonly index: string;
  readonly code: string;
  readonly englishTitle: string;
  readonly title: string;
}

export const ANNOTATION_PRODUCTION_LANE_PRESENTATION = {
  tags: {
    index: "01",
    code: "TAG",
    englishTitle: "TAG SYNTHESIS",
    title: "标签生产线路",
  },
  description: {
    index: "02",
    code: "DSC",
    englishTitle: "DESCRIPTION SYNTHESIS",
    title: "描述生产线路",
  },
  translation: {
    index: "03",
    code: "TRN",
    englishTitle: "TRANSLATION SYNTHESIS",
    title: "译文生产线路",
  },
} as const satisfies Readonly<Record<AnnotationLaneId, ProductionLanePresentation>>;

export const ANNOTATION_PRODUCTION_PHASES = [
  { index: "01", label: "ROUTE" },
  { index: "02", label: "SNAPSHOT" },
  { index: "03", label: "RUN" },
  { index: "04", label: "RESULT" },
] as const;
