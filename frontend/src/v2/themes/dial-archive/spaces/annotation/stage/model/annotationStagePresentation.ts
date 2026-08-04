import type {
  AnnotationCoverageLane,
  AnnotationLaneId,
  AnnotationOperationSummary,
  AnnotationStageAsset,
  AnnotationWorkcellId,
} from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_LANE_PRESENTATION } from "../../model/annotationPresentation";

interface WorkcellPresentation {
  code: string;
  title: string;
  englishTitle: string;
  description: string;
  action: string;
}

export const ANNOTATION_WORKCELL_PRESENTATION: Readonly<
  Record<AnnotationWorkcellId, WorkcellPresentation>
> = {
  edit: {
    code: "WC.01",
    title: "标注编辑",
    englishTitle: "EDIT",
    description: "围绕当前素材编辑标签、描述与译文。",
    action: "展开编辑工作间",
  },
  production: {
    code: "WC.02",
    title: "自动生产",
    englishTitle: "PRODUCTION",
    description: "以当前范围建立模型批量生产线路。",
    action: "展开生产工作间",
  },
  dossier: {
    code: "WC.03",
    title: "对象档案",
    englishTitle: "DOSSIER",
    description: "查看当前素材的元数据、历史与证据。",
    action: "展开档案工作间",
  },
};

const CHANNEL_STATE_CODES: Readonly<Record<string, string>> = {
  usable: "OK",
  valid: "OK",
  reviewed: "REV",
  unreviewed: "NEW",
  needs_review: "CHECK",
  failed: "FAIL",
  stale: "STALE",
  invalid: "ERR",
  missing: "—",
};

export interface WorkcellChannelReading {
  lane: AnnotationLaneId;
  code: string;
  state: string;
  stateCode: string;
}

/** 当前素材三条泳道的真实状态读数；没有记录时为 missing，不虚构 */
export function readAssetChannelStates(
  asset: AnnotationStageAsset | null,
): readonly WorkcellChannelReading[] {
  return (["tags", "description", "translation"] as const).map((lane) => {
    const state = asset?.channelStatuses[lane] ?? "missing";
    return {
      lane,
      code: ANNOTATION_LANE_PRESENTATION[lane].code,
      state,
      stateCode: CHANNEL_STATE_CODES[state] ?? state.toUpperCase().slice(0, 5),
    };
  });
}

export interface WorkcellStatusLine {
  label: string;
  live: boolean;
}

/**
 * 远景证据优先承接批量范围中的真实对象，再以当前对象两侧的邻近素材补齐。
 * 当前对象永远留在前台，不在远景中重复出现。
 */
export function selectStageEvidenceAssets(
  assets: readonly AnnotationStageAsset[],
  currentIndex: number,
  checkedAssetIds: readonly string[],
  limit: number,
): readonly AnnotationStageAsset[] {
  if (limit <= 0 || assets.length <= 1) return [];

  const current = assets[currentIndex] ?? null;
  const selected: AnnotationStageAsset[] = [];
  const selectedIds = new Set<string>();
  const checkedIds = new Set(checkedAssetIds);
  const include = (asset: AnnotationStageAsset | undefined) => {
    if (
      !asset ||
      asset.id === current?.id ||
      selectedIds.has(asset.id) ||
      selected.length >= limit
    ) {
      return;
    }
    selectedIds.add(asset.id);
    selected.push(asset);
  };

  for (const asset of assets) {
    if (checkedIds.has(asset.id)) include(asset);
  }

  for (let distance = 1; selected.length < limit && distance < assets.length; distance += 1) {
    include(assets[currentIndex - distance]);
    include(assets[currentIndex + distance]);
  }

  for (const asset of assets) include(asset);
  return selected;
}

/** 每个工作间的"可继续状态"，全部来自真实数据 */
export function describeWorkcellStatus(
  workcell: AnnotationWorkcellId,
  asset: AnnotationStageAsset | null,
  checkedCount: number,
  totalCount: number,
  channels: readonly AnnotationCoverageLane[],
  operation: AnnotationOperationSummary | null,
): WorkcellStatusLine {
  if (workcell === "edit") {
    if (!asset) return { label: "等待素材", live: false };
    const readings = readAssetChannelStates(asset);
    const usableStates = new Set(["usable", "valid", "reviewed", "unreviewed"]);
    const done = readings.filter((reading) => usableStates.has(reading.state)).length;
    return { label: `通道 ${done}/${readings.length} 有效`, live: false };
  }
  if (workcell === "production") {
    if (operation?.active) {
      return {
        label: `${operation.statusLabel} ${operation.progressPercent}%`,
        live: true,
      };
    }
    if (checkedCount > 0) return { label: `${checkedCount} 素材在范围内`, live: false };
    return { label: `全部 ${totalCount} 素材可承接`, live: false };
  }
  if (!asset) return { label: "等待素材", live: false };
  const lane = channels.find((channel) => channel.id === "tags");
  return {
    label: lane ? `项目覆盖 ${lane.coveragePercent}%` : asset.relativePath,
    live: false,
  };
}
