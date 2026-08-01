import type {
  AnnotationChannel,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState";

export interface AnnotationEditorView {
  mode: AnnotationChannel;
  language: string;
  translationSourceKind: TranslationSourceKind;
  translationProducerKind: TranslationProducerKind;
}

export const annotationEditorViewState = createScopedViewState<AnnotationEditorView>(() => ({
  mode: "description",
  language: "zh-CN",
  translationSourceKind: "description",
  translationProducerKind: "llm",
}));
