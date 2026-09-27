import { useState } from "react";
import type {
  CharacterAuditContent,
  CharacterTagConflict,
} from "../../../../pages/spaces/spacePageModel";
import { CHARACTER_DECISION_LABELS as DECISION_LABELS } from "../../../../pages/spaces/spacePageModel";

interface Props {
  content: CharacterAuditContent;
  conflict: CharacterTagConflict;
  index: number;
}

export function CharacterConflict({ content, conflict, index }: Props) {
  const [reason, setReason] = useState(conflict.resolution?.reason ?? "");
  const source = content.sourceImages.find((image) => image.id === conflict.asset_id);
  return (
    <fieldset className="dial-archive-character-conflict">
      <legend>
        {conflict.tag} / {source?.name ?? conflict.asset_id}
      </legend>
      {source && (
        <a href={source.imageUrl} target="_blank" rel="noreferrer">
          <img
            className="dial-archive-character-reference-thumb"
            src={source.imageUrl}
            alt={`冲突图片 ${source.name}`}
          />
        </a>
      )}
      <ul>
        {conflict.proposals.map((item, i) => (
          <li key={i}>
            {DECISION_LABELS[item.decision]} {item.replacement ?? ""} · {item.reason}
          </li>
        ))}
      </ul>
      {conflict.resolution && (
        <p>
          已裁决：
          {conflict.resolution.decision === "keep"
            ? "保留原标签"
            : conflict.resolution.replacement}{" "}
          · {conflict.resolution.reason}
        </p>
      )}
      <label>
        人工裁决理由
        <input
          data-testid={`character-conflict-reason-${index}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="核对共享图片后，记录保留或替换的具体依据"
        />
      </label>
      <button
        type="button"
        data-testid={`character-conflict-keep-${index}`}
        disabled={content.busy || !reason.trim()}
        onClick={() =>
          void content.resolveConflict({
            asset_id: conflict.asset_id,
            tag: conflict.tag,
            decision: "keep",
            replacement: null,
            reason,
          })
        }
      >
        确认保留原标签
      </button>
      {conflict.proposals.map(
        (item, proposalIndex) =>
          item.decision === "replace" && (
            <button
              type="button"
              key={proposalIndex}
              data-testid={`character-conflict-replace-${index}-${proposalIndex}`}
              disabled={content.busy || !reason.trim()}
              onClick={() =>
                void content.resolveConflict({
                  asset_id: conflict.asset_id,
                  tag: conflict.tag,
                  decision: "replace",
                  replacement: item.replacement,
                  reason,
                })
              }
            >
              确认替换为 {item.replacement}
            </button>
          ),
      )}
    </fieldset>
  );
}
