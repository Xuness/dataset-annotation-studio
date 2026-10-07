import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { lookupAsset } from "../../features/assets/api";
import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";
import type { CharacterAudit } from "../../shared/api/contracts/characterAudits";
import { useAssetBrowserData } from "../workspace/useAssetBrowserData";
import { characterBrowserState } from "./characterBrowserState";

export function useCharacterAssets(
  project: string,
  operation: CharacterAudit | null,
  entry: string | null,
) {
  const state = characterBrowserState.useValue(project);
  const query = useMemo(
    () => ({
      search: state.search,
      status: state.statusFilter,
      folderPath: state.folderPath,
      candidateScope: state.candidateScope,
    }),
    [state.search, state.statusFilter, state.folderPath, state.candidateScope],
  );
  const data = useAssetBrowserData(project, query);
  const { items } = data;
  const loaded = items.find((item) => item.id === state.selectedAssetId);
  const lookup = useQuery({
    queryKey: [
      ...workspaceQueryKeys.scope(project, "assets"),
      "character-preview",
      state.selectedAssetId,
    ],
    queryFn: () =>
      lookupAsset(project, state.selectedAssetId!, {
        search: "",
        status: null,
        folder_path: "",
        candidate_scope: "all",
      }),
    initialData: loaded,
    enabled: Boolean(state.selectedAssetId && !loaded),
  });
  const focusToken = operation ? `${operation.id}:${entry ?? ""}` : null;
  useEffect(() => {
    if (operation && state.operationFocus !== focusToken) {
      characterBrowserState.patch(project, {
        operationFocus: focusToken,
        selectedAssetId: operation.references[0]?.asset_id ?? null,
        reviewView: "review",
      });
    } else if (
      (!state.selectedAssetId || (!loaded && lookup.isSuccess && lookup.data === null)) &&
      items.length
    ) {
      characterBrowserState.patch(project, { selectedAssetId: items[0].id });
    }
  }, [
    operation,
    focusToken,
    state.operationFocus,
    state.selectedAssetId,
    project,
    items,
    loaded,
    lookup.isSuccess,
    lookup.data,
  ]);
  return {
    state,
    ...data,
    selected: loaded ?? lookup.data ?? null,
    error: data.error ?? lookup.error?.message ?? null,
    patch: (value: Partial<typeof state>) => characterBrowserState.patch(project, value),
    select: async (id: string) => {
      characterBrowserState.patch(project, { selectedAssetId: id });
      return true;
    },
  };
}
export type CharacterAssetsController = ReturnType<typeof useCharacterAssets>;
