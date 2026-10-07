import type { CharacterAuditRequest } from "../../shared/api/contracts/characterAudits";

export function validateCharacterAuditRequest(request: CharacterAuditRequest): void {
  const issues: string[] = [];
  if (request.profiles.length < 1 || request.profiles.length > 4)
    issues.push("请配置 1 至 4 个角色");
  const triggers = new Set<string>();
  for (const [index, profile] of request.profiles.entries()) {
    const name = `角色 ${index + 1}`;
    const trigger = profile.trigger.trim();
    if (!trigger) issues.push(`${name}：请填写唯一触发词`);
    else if (trigger.length > 500 || /[,\r\n\0]/u.test(trigger))
      issues.push(`${name}：触发词不能超过 500 个字符，也不能包含逗号、换行或空字符`);
    const key = trigger.toLowerCase().replace(/\s+/gu, "_");
    if (trigger && triggers.has(key)) issues.push(`${name}：触发词与其他角色重复`);
    triggers.add(key);
    if (!profile.reference_asset_id.trim()) issues.push(`${name}：请选择参考图`);
    if (profile.membership === "directory" && profile.directory === null)
      issues.push(`${name}：请指定归属目录，项目根目录可留空`);
    if (profile.directory !== null && !relativeDirectory(profile.directory))
      issues.push(`${name}：归属目录必须是项目内的相对路径，不能包含上级目录或反斜杠`);
  }
  if (!request.provider_profile_id.trim()) issues.push("请选择审查模型连接");
  if (!request.model_id.trim()) issues.push("请选择视觉模型");
  if (!/^[a-f0-9]{64}$/u.test(request.vocabulary_id))
    issues.push("请选择已验证的语义词表；尚未安装时，请展开“重试与语义词表”导入完整词表");
  if (!Number.isInteger(request.minimum_count) || request.minimum_count < 1)
    issues.push("最低图片出现次数必须是大于或等于 1 的整数");
  if (!Number.isInteger(request.retry_limit) || request.retry_limit < 0 || request.retry_limit > 5)
    issues.push("每阶段额外重试次数必须是 0 至 5 的整数");
  if (request.scope === "selected" && !request.asset_ids.length)
    issues.push("已选素材为空，请先勾选图片；不会自动扩大到整个项目");
  if (request.scope === "directory" && request.directory === null)
    issues.push("请选择处理目录，项目根目录可留空");
  if (request.directory !== null && !relativeDirectory(request.directory))
    issues.push("处理目录必须是项目内的相对路径，不能包含上级目录或反斜杠");
  if (issues.length) throw new RangeError(`请完善角色审查配置：${issues.join("；")}。`);
}

function relativeDirectory(value: string): boolean {
  return !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..");
}
