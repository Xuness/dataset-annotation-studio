import { useQuery } from "@tanstack/react-query";

import { getTagFrequency } from "./api";
import { statisticsKeys } from "./queryKeys";

export function useTagFrequency(projectId: string) {
  return useQuery({
    queryKey: statisticsKeys.tagFrequency(projectId),
    queryFn: () => getTagFrequency(projectId),
    enabled: Boolean(projectId),
  });
}
