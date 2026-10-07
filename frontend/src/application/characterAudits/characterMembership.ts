import type { CharacterAudit } from "../../shared/api/contracts/characterAudits";

export function membershipLabel(
  operation: CharacterAudit,
  profileIndex: number,
  id: string,
): string {
  const snapshot = operation.source_assets.find((asset) => asset.asset_id === id);
  const profile = operation.request.profiles[profileIndex];
  if (!snapshot || !profile) return "未纳入本次任务范围 · 仅供对照";
  const member =
    profile.membership === "directory"
      ? !profile.directory || snapshot.relative_path.startsWith(`${profile.directory}/`)
      : snapshot.tags.some(
          (tag) =>
            tag.name.trim().toLowerCase().replace(/\s+/gu, "_") ===
            profile.trigger.trim().toLowerCase().replace(/\s+/gu, "_"),
        );
  return member
    ? `属于 ${profile.trigger} · 按任务输入快照判断`
    : `不属于当前角色 ${profile.trigger} · 仅供对照`;
}
