import { useMemo } from "react";
import { ChevronDown } from "lucide-react";

import {
  useTokenizationProfiles,
  type TokenCountQuery,
} from "../../../features/tokenization/hooks";
import type { TokenizationProfile, TokenizationProfileId } from "../../../shared/api/types";

const FALLBACK_PROFILES: TokenizationProfile[] = [
  {
    id: "krea2",
    name: "Krea 2",
    description:
      "Qwen3-VL-4B；按 Krea 2 训练模板计算有效文本编码长度，包含 assistant 后缀并扣除固定前缀。",
    metrics: [{ id: "qwen3_vl_4b", label: "Qwen3-VL-4B", short_label: "Q3-VL" }],
  },
  {
    id: "anima",
    name: "Anima",
    description: "同时计算 Anima 使用的 Qwen3-0.6B 与 T5 v1.1 XXL。",
    metrics: [
      { id: "qwen3_0_6b", label: "Qwen3-0.6B", short_label: "Q3" },
      { id: "t5_v1_1_xxl", label: "T5 v1.1 XXL", short_label: "T5" },
    ],
  },
  {
    id: "t5",
    name: "T5",
    description: "google/t5-v1_1-xxl Fast Tokenizer，包含一个 EOS。",
    metrics: [{ id: "t5_v1_1_xxl", label: "T5 v1.1 XXL", short_label: "T5" }],
  },
];

const TOKEN_DISCLAIMER = "这是训练预设下的文本编码长度，不是 LLM 服务商请求或计费 Token。";

interface TokenProfileSelectProps {
  value: TokenizationProfileId;
  onChange: (value: TokenizationProfileId) => void;
}

export function TokenProfileSelect({ value, onChange }: TokenProfileSelectProps) {
  const profiles = useTokenizationProfiles();
  const options = profiles.data ?? FALLBACK_PROFILES;
  const active = options.find((profile) => profile.id === value) ?? FALLBACK_PROFILES[0];

  return (
    <span className="token-profile-control" title={`${active.description} ${TOKEN_DISCLAIMER}`}>
      <select
        className="token-profile-select"
        aria-label="Token 训练预设"
        value={value}
        onChange={(event) => onChange(event.target.value as TokenizationProfileId)}
      >
        {options.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      <ChevronDown size={11} aria-hidden="true" />
    </span>
  );
}

interface TokenCountBadgesProps {
  profileId: TokenizationProfileId;
  itemId: string;
  query: TokenCountQuery;
  className?: string;
}

export function TokenCountBadges({ profileId, itemId, query, className }: TokenCountBadgesProps) {
  const fallbackProfile =
    FALLBACK_PROFILES.find((profile) => profile.id === profileId) ?? FALLBACK_PROFILES[0];
  const profile = query.data?.profile.id === profileId ? query.data.profile : fallbackProfile;
  const result = query.data?.items.find((item) => item.id === itemId);
  const countByMetric = useMemo(
    () => new Map(result?.metrics.map((metric) => [metric.metric_id, metric.count]) ?? []),
    [result],
  );
  const title = query.error
    ? `${query.error.message} ${TOKEN_DISCLAIMER}`
    : `${profile.description} ${TOKEN_DISCLAIMER}`;

  return (
    <span
      className={["token-count-badges", className].filter(Boolean).join(" ")}
      title={title}
      data-token-profile={profileId}
    >
      {profile.metrics.map((metric) => {
        const count = countByMetric.get(metric.id);
        const value = query.error ? "—" : count === undefined ? "…" : count.toLocaleString();
        return (
          <span
            key={metric.id}
            className={[
              "token-count-badge",
              query.isPending ? "is-pending" : "",
              query.error ? "is-error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`${metric.label} Token：${value}`}
          >
            <span>{metric.short_label}</span>
            <strong>{value}</strong>
          </span>
        );
      })}
    </span>
  );
}
