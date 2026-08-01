const modalityLabels: Record<string, string> = {
  text: "文本",
  image: "图片",
  audio: "音频",
  video: "视频",
};

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimNumber(value / 1_000)}K`;
  return String(value);
}

export function formatPrice(value: string | null): string | null {
  if (value === null) return null;
  const perMillion = Number(value) * 1_000_000;
  if (!Number.isFinite(perMillion)) return null;
  if (perMillion === 0) return "免费";
  return `$${trimNumber(perMillion)} / M`;
}

export function formatModalities(modalities: string[]): string {
  return modalities.map((modality) => modalityLabels[modality] ?? modality).join(" / ");
}

function trimNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}
