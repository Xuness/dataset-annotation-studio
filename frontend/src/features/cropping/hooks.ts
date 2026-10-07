import { useQuery } from "@tanstack/react-query";

import { getCropSource } from "./api";

export function useCropSource(projectId: string, assetId: string) {
  return useQuery({
    queryKey: ["crop-source", projectId, assetId],
    queryFn: () => getCropSource(projectId, assetId),
    enabled: Boolean(projectId && assetId),
  });
}
