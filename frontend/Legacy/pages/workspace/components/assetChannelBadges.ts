export const channelStatusLabels: Record<string, string> = {
  reviewed: "已复核",
  unreviewed: "尚未复核",
  stale: "已过期",
  invalid: "结构异常",
  encoding_error: "编码异常",
  empty: "空内容",
  unchecked: "未校验",
};

export function channelBadge(channel: string): {
  shortLabel: string;
  label: string;
  priority: number;
} {
  if (channel === "existing_annotation") {
    return { shortLabel: "原", label: "原有标注", priority: 0 };
  }
  if (channel === "tags") {
    return { shortLabel: "T", label: "Tags", priority: 1 };
  }
  if (channel === "description") {
    return { shortLabel: "L", label: "LLM 描述", priority: 2 };
  }
  const translationParts = channel.startsWith("translation:") ? channel.split(":") : [];
  const canonicalTranslation = translationParts.length >= 4;
  const sourceKind = canonicalTranslation ? translationParts[1] : "description";
  const language = canonicalTranslation
    ? translationParts.slice(3).join(":")
    : channel.startsWith("translation:")
      ? channel.slice("translation:".length)
      : "";
  if (!canonicalTranslation) {
    return {
      shortLabel: language || "译",
      label: language ? `${language} 译文` : "翻译",
      priority: 3,
    };
  }
  const sourceLabel = sourceKind === "tags" ? "Tags" : "LLM 描述";
  return {
    shortLabel: language ? `${sourceKind === "tags" ? "T" : "L"}·${language}` : "译",
    label: language ? `${sourceLabel} · ${language} 译文` : "翻译",
    priority: 3,
  };
}
