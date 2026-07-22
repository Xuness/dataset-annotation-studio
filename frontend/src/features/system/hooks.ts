import { useQuery } from "@tanstack/react-query";

import { getSystemDiagnostics } from "./api";
import { systemKeys } from "./queryKeys";

export function useSystemDiagnostics() {
  return useQuery({
    queryKey: systemKeys.diagnostics,
    queryFn: getSystemDiagnostics,
    retry: false,
    staleTime: 5_000,
  });
}
