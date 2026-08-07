import { useMemo } from "react";

import {
  useProviderProfiles,
  useSystemPresets,
  useTranslationPromptPresets,
} from "../../../../features/presets/hooks";
import { useTagDictionaryLibrary } from "../../../../features/tagDictionaries/hooks";
import { useTaggerLibrary } from "../../../../features/taggers/hooks";
import { useHasUnreadUpdateAnnouncement } from "../../../../features/updateAnnouncements/readState";
import { useSystemDiagnostics } from "../../../../features/system/hooks";
import type {
  SystemDiagnostics,
  TagDictionaryLibrary,
  TaggerLibrary,
} from "../../../../shared/api/types";
import {
  createCapabilityLibraryOverview,
  type CapabilityLibraryCategoryId,
  type CapabilityLibraryContent,
  type CapabilityLibrarySourceState,
} from "./capabilityLibraryModel";

interface UseCapabilityLibraryControllerOptions {
  onOpenCategory?(categoryId: CapabilityLibraryCategoryId): void;
}

function isTaggerLibrary(value: unknown): value is TaggerLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TaggerLibrary>;
  return (
    Array.isArray(candidate.installations) &&
    Array.isArray(candidate.profiles) &&
    Boolean(candidate.runtime && typeof candidate.runtime === "object")
  );
}

function isDictionaryLibrary(value: unknown): value is TagDictionaryLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TagDictionaryLibrary>;
  return typeof candidate.entry_count === "number" && typeof candidate.override_count === "number";
}

function isSystemDiagnostics(value: unknown): value is SystemDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SystemDiagnostics>;
  return candidate.status === "ok" && typeof candidate.version === "string";
}

function sourceState(isPending: boolean, isError: boolean): CapabilityLibrarySourceState {
  if (isError) return "error";
  return isPending ? "loading" : "ready";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "能力索引读取失败";
}

export function useCapabilityLibraryController(
  options: UseCapabilityLibraryControllerOptions = {},
): CapabilityLibraryContent {
  const providers = useProviderProfiles();
  const taggers = useTaggerLibrary();
  const dictionaries = useTagDictionaryLibrary();
  const systemPrompts = useSystemPresets();
  const translationPrompts = useTranslationPromptPresets();
  const diagnostics = useSystemDiagnostics();
  const hasUnreadAnnouncement = useHasUnreadUpdateAnnouncement();
  const overview = useMemo(
    () =>
      createCapabilityLibraryOverview({
        providers: Array.isArray(providers.data) ? providers.data : [],
        taggers: isTaggerLibrary(taggers.data) ? taggers.data : null,
        dictionaries: isDictionaryLibrary(dictionaries.data) ? dictionaries.data : null,
        systemPrompts: Array.isArray(systemPrompts.data) ? systemPrompts.data : [],
        translationPrompts: Array.isArray(translationPrompts.data) ? translationPrompts.data : [],
        diagnostics: isSystemDiagnostics(diagnostics.data) ? diagnostics.data : null,
        hasUnreadAnnouncement,
        sources: {
          providers: sourceState(providers.isPending, providers.isError),
          taggers: sourceState(taggers.isPending, taggers.isError),
          dictionaries: sourceState(dictionaries.isPending, dictionaries.isError),
          systemPrompts: sourceState(systemPrompts.isPending, systemPrompts.isError),
          translationPrompts: sourceState(translationPrompts.isPending, translationPrompts.isError),
          diagnostics: sourceState(diagnostics.isPending, diagnostics.isError),
        },
        errors: [
          providers.isError ? errorMessage(providers.error) : null,
          taggers.isError ? errorMessage(taggers.error) : null,
          dictionaries.isError ? errorMessage(dictionaries.error) : null,
          systemPrompts.isError ? errorMessage(systemPrompts.error) : null,
          translationPrompts.isError ? errorMessage(translationPrompts.error) : null,
          diagnostics.isError ? errorMessage(diagnostics.error) : null,
        ].filter((message): message is string => message !== null),
      }),
    [
      diagnostics.data,
      diagnostics.isError,
      diagnostics.isPending,
      diagnostics.error,
      dictionaries.data,
      dictionaries.isError,
      dictionaries.isPending,
      dictionaries.error,
      hasUnreadAnnouncement,
      providers.data,
      providers.isError,
      providers.isPending,
      providers.error,
      systemPrompts.data,
      systemPrompts.isError,
      systemPrompts.isPending,
      systemPrompts.error,
      taggers.data,
      taggers.isError,
      taggers.isPending,
      taggers.error,
      translationPrompts.data,
      translationPrompts.isError,
      translationPrompts.isPending,
      translationPrompts.error,
    ],
  );

  const refresh = () => {
    void Promise.all([
      providers.refetch(),
      taggers.refetch(),
      dictionaries.refetch(),
      systemPrompts.refetch(),
      translationPrompts.refetch(),
      diagnostics.refetch(),
    ]);
  };

  return {
    kind: "capability-library",
    ...overview,
    openCategory: (categoryId) => options.onOpenCategory?.(categoryId),
    refresh,
  };
}
