import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TaggerProfileInput } from "../../shared/api/types";
import {
  createTaggerProfile,
  deleteTaggerInstallation,
  deleteTaggerProfile,
  getTaggerLibrary,
  importLocalTagger,
  rescanTaggers,
  updateTaggerModelRoot,
  updateTaggerProfile,
  validateTaggerInstallation,
} from "./api";
import { taggerKeys } from "./queryKeys";

export function useTaggerLibrary() {
  return useQuery({ queryKey: taggerKeys.library, queryFn: getTaggerLibrary });
}

export function useTaggerActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: taggerKeys.all });
  return {
    setRoot: useMutation({ mutationFn: updateTaggerModelRoot, onSuccess: refresh }),
    importLocal: useMutation({
      mutationFn: ({ path, name }: { path: string; name?: string }) =>
        importLocalTagger(path, name),
      onSuccess: refresh,
    }),
    rescan: useMutation({ mutationFn: rescanTaggers, onSuccess: refresh }),
    validate: useMutation({ mutationFn: validateTaggerInstallation, onSuccess: refresh }),
    removeInstallation: useMutation({
      mutationFn: deleteTaggerInstallation,
      onSuccess: refresh,
    }),
    createProfile: useMutation({ mutationFn: createTaggerProfile, onSuccess: refresh }),
    updateProfile: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<TaggerProfileInput> }) =>
        updateTaggerProfile(id, input),
      onSuccess: refresh,
    }),
    removeProfile: useMutation({ mutationFn: deleteTaggerProfile, onSuccess: refresh }),
  };
}
