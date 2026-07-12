import { useQuery } from "@tanstack/react-query";

import { getTagFrequency } from "./api";

export function useTagFrequency(projectId: string) {
  return useQuery({
    queryKey: ["statistics", projectId, "tag-frequency"],
    queryFn: () => getTagFrequency(projectId),
    enabled: Boolean(projectId),
  });
}
