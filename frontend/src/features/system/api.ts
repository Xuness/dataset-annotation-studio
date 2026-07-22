import { apiRequest } from "../../shared/api/client";
import type { SystemDiagnostics } from "../../shared/api/types";

export function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  return apiRequest("/api/v1/system/diagnostics");
}
