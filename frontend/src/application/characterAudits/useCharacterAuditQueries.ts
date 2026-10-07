import { useQuery } from "@tanstack/react-query";
import { getCharacterAudit, listCharacterAudits } from "../../features/characterAudits/api";
import { ACTIVE_CHARACTER_AUDIT_STATUSES } from "./characterAuditModel";

export function useCharacterAuditHistory(projectId: string | null) {
  return useQuery({
    queryKey: ["character-audits", projectId],
    queryFn: () => {
      if (!projectId) throw new Error("读取角色审查记录前必须选择项目。");
      return listCharacterAudits(projectId);
    },
    enabled: Boolean(projectId),
    refetchInterval: 2000,
  });
}

export function useCharacterAudit(projectId: string | null, operationId: string | null) {
  return useQuery({
    queryKey: ["character-audit", projectId, operationId],
    queryFn: () => {
      if (!projectId || !operationId) throw new Error("读取角色审查详情前必须选择项目和任务。");
      return getCharacterAudit(projectId, operationId);
    },
    enabled: Boolean(projectId && operationId),
    refetchInterval: (query) =>
      query.state.data && ACTIVE_CHARACTER_AUDIT_STATUSES.has(query.state.data.status)
        ? 1000
        : false,
  });
}
