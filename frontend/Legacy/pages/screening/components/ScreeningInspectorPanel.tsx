import { BarChart3, FileWarning, ShieldCheck } from "lucide-react";

import { thumbnailUrl } from "../../../../src/features/assets/api";
import type {
  ScreeningItem,
  ScreeningOperation,
  ScreeningPool,
  ScreeningRating,
} from "../../../../src/shared/api/types";

const poolLabels: Record<ScreeningPool, string> = {
  elite_candidate: "精选候选",
  recommended: "推荐",
  low_evidence_protected: "低证据保护",
  review: "待人工复核",
  task_mismatch: "角色任务不适配",
  low_priority_high_confidence: "高置信低优先",
  quarantine: "隔离复核",
  invalid: "元数据异常",
};

const ratingLabels: Record<ScreeningRating, string> = {
  g: "General (g)",
  s: "Sensitive (s)",
  q: "Questionable (q)",
  e: "Explicit (e)",
};

const taskReasonLabels: Record<string, string> = {
  TASK_COMIC_PANEL: "漫画 / 分镜",
  TASK_MULTIPLE_VIEWS: "多视图 / 设定图",
  TASK_MONOCHROME_GREYSCALE: "黑白 / 灰度",
  TASK_LINEART_SKETCH: "线稿 / 草图",
  TASK_CROWD_3PLUS: "三人及以上",
  TASK_TAGS_UNAVAILABLE: "缺少任务适配标签",
  TASK_MISMATCH_STRONG_PENALTY: "强任务惩罚：进入任务不适配池",
};

function score(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (value <= 1 ? value * 100 : value).toFixed(1);
}

function count(operation: ScreeningOperation, pool: ScreeningPool): number {
  return operation.pool_counts[pool] ?? 0;
}

function filename(item: ScreeningItem): string {
  return item.source_relative_path.split(/[\\/]/u).at(-1) || item.source_relative_path;
}

function evidenceConfidence(item: ScreeningItem): number | null {
  const values = [item.confidence_pop, item.confidence_depth, item.confidence_vote].filter(
    (value, index): value is number =>
      value !== null && (index !== 2 || item.score_details?.vote_posterior_mean !== null),
  );
  return values.length ? Math.min(...values) : null;
}

export function ScreeningInspectorPanel({
  projectId,
  operation,
  item,
}: {
  projectId: string;
  operation: ScreeningOperation | null;
  item: ScreeningItem | null;
}) {
  if (!operation) {
    return (
      <aside className="screening-inspector" data-surface-region="secondary-sidebar">
        <div className="screening-inspector-empty">
          <BarChart3 size={26} />
          <h2>批次统计与解释</h2>
          <p>运行一次筛选，或从左侧打开历史记录。</p>
        </div>
      </aside>
    );
  }

  if (!item) {
    const progress = operation.total_items
      ? Math.min(100, Math.round((operation.processed_items / operation.total_items) * 100))
      : 0;
    return (
      <aside className="screening-inspector" data-surface-region="secondary-sidebar">
        <header className="screening-panel-heading">
          <span className="screening-panel-icon">
            <BarChart3 size={16} />
          </span>
          <div>
            <span className="eyebrow">Batch Summary</span>
            <h2>本次统计</h2>
          </div>
        </header>
        <div className="screening-operation-status">
          <strong>
            {operation.processed_items} / {operation.total_items}
          </strong>
          <span>{operation.status === "completed" ? "筛选已完成" : "批次处理中"}</span>
          <i>
            <span style={{ width: `${progress}%` }} />
          </i>
          {operation.current_relative_path ? (
            <small>{operation.current_relative_path}</small>
          ) : null}
        </div>
        <dl className="screening-summary-grid">
          <div>
            <dt>精选</dt>
            <dd>{count(operation, "elite_candidate")}</dd>
          </div>
          <div>
            <dt>推荐</dt>
            <dd>{count(operation, "recommended")}</dd>
          </div>
          <div>
            <dt>保护</dt>
            <dd>{count(operation, "low_evidence_protected")}</dd>
          </div>
          <div>
            <dt>待审</dt>
            <dd>{count(operation, "review")}</dd>
          </div>
          <div>
            <dt>低优先</dt>
            <dd>{count(operation, "low_priority_high_confidence")}</dd>
          </div>
          <div>
            <dt>任务不适配</dt>
            <dd>{count(operation, "task_mismatch")}</dd>
          </div>
          <div>
            <dt>隔离</dt>
            <dd>{count(operation, "quarantine")}</dd>
          </div>
          <div>
            <dt>异常</dt>
            <dd>{count(operation, "invalid")}</dd>
          </div>
        </dl>
        <section className="screening-inspector-section">
          <h3>附加标记</h3>
          <p>低分辨率 {operation.low_resolution_count ?? "按结果过滤查看"}</p>
          <p>重复 / 变体 {operation.duplicate_variant_count ?? "按结果过滤查看"}</p>
        </section>
        <section className="screening-inspector-section">
          <h3>任务适配层</h3>
          {operation.task_profile_snapshot ? (
            <>
              <p>
                {operation.task_profile_snapshot.profile_version} · 已评估{" "}
                {operation.task_evaluated_items}张
              </p>
              {operation.task_unavailable_items ? (
                <p>{operation.task_unavailable_items} 张缺少可用标签，未伪造任务分。</p>
              ) : null}
            </>
          ) : (
            <p>该历史任务尚未生成独立任务适配分。</p>
          )}
        </section>
        <section className="screening-inspector-section">
          <h3>运行边界</h3>
          <p>候选池、排名和百分位只在本次冻结的数据集中计算，并按 Rating 分区比较。</p>
          <p>公式版本 {operation.score_version}。筛选结果不会自动删除或移动文件。</p>
        </section>
        {operation.error_message ? <p className="form-error">{operation.error_message}</p> : null}
      </aside>
    );
  }

  const components = [
    ["同龄流行度", item.score_details?.popularity_percentile_final ?? null],
    ["收藏深度", item.score_details?.depth_percentile_final ?? null],
    ["投票保留信号", item.score_details?.vote_keep_signal ?? null],
    ["技术质量", item.technical_score],
  ] as const;
  const activePool = item.candidate_pool;

  return (
    <aside className="screening-inspector" data-surface-region="secondary-sidebar">
      <header className="screening-inspector-item-heading">
        <img src={thumbnailUrl(projectId, item.asset_id, operation.id, 640)} alt="" />
        <div>
          <span className={`screening-pool-badge is-${activePool ?? item.status}`}>
            {activePool ? poolLabels[activePool] : "正在处理"}
          </span>
          <h2 title={filename(item)}>{filename(item)}</h2>
          <small title={item.source_relative_path}>{item.source_relative_path}</small>
        </div>
      </header>

      <dl className="screening-score-grid">
        <div>
          <dt>核心质量</dt>
          <dd>{score(item.final_score)}</dd>
        </div>
        <div>
          <dt>任务适配</dt>
          <dd>{score(item.task_fit_score)}</dd>
        </div>
        <div>
          <dt>角色排序分</dt>
          <dd>{score(item.selection_score)}</dd>
        </div>
        <div>
          <dt>证据置信</dt>
          <dd>{score(evidenceConfidence(item))}%</dd>
        </div>
        <div>
          <dt>Keep</dt>
          <dd>{score(item.keep_score)}</dd>
        </div>
        <div>
          <dt>Elite</dt>
          <dd>{score(item.elite_score)}</dd>
        </div>
      </dl>

      <section className="screening-inspector-section">
        <h3>批次内位置</h3>
        <p>
          {item.rating ? ratingLabels[item.rating] : "Rating 缺失"} · 排名 #
          {item.rating_rank ?? "—"} · 百分位 {score(item.rating_percentile)}%
        </p>
        <p>
          角色任务排名 #{item.selection_rank ?? "—"} · 百分位 {score(item.selection_percentile)}%
        </p>
        {item.quality_candidate_pool ? (
          <p>核心质量池：{poolLabels[item.quality_candidate_pool]}</p>
        ) : null}
        <p>
          {item.image_width ?? "—"} × {item.image_height ?? "—"}
        </p>
      </section>

      <section className="screening-inspector-section">
        <h3>角色 LoRA 适配</h3>
        {item.task_reason_codes.length ? (
          <div className="screening-reason-list">
            {item.task_reason_codes.map((reason) => (
              <span key={reason}>{taskReasonLabels[reason] ?? reason}</span>
            ))}
          </div>
        ) : item.task_fit_score !== null ? (
          <p>未命中已启用的任务惩罚规则。</p>
        ) : (
          <p>缺少缓存标签，任务适配分不可用。</p>
        )}
        {item.task_matched_tags.length ? (
          <p>命中标签：{item.task_matched_tags.join(", ")}</p>
        ) : null}
      </section>

      <section className="screening-inspector-section">
        <h3>分项证据</h3>
        <dl className="screening-component-list">
          {components.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{score(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="screening-inspector-section">
        <h3>
          <ShieldCheck size={14} /> 判断依据
        </h3>
        <div className="screening-reason-list">
          {item.reason_codes.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
          {!item.reason_codes.length ? <p>没有额外判断代码。</p> : null}
        </div>
      </section>

      {item.low_resolution_flag ||
      item.pixel_duplicate_group ||
      item.variant_group ||
      item.warnings.length ||
      item.error_message ? (
        <section className="screening-inspector-section is-warning">
          <h3>
            <FileWarning size={14} /> 标记与警告
          </h3>
          {item.low_resolution_flag ? <p>低分辨率：仅作为标记显示，不自动删除。</p> : null}
          {item.pixel_duplicate_group ? (
            <p>
              重复组：{item.pixel_duplicate_group}
              {item.duplicate_of_asset_id
                ? `；代表素材 ${item.duplicate_of_asset_id}`
                : "；当前为代表素材"}
              ；结果页默认隐藏非代表重复项。
            </p>
          ) : null}
          {item.variant_group ? <p>Danbooru 变体组：{item.variant_group}，不参与扣分。</p> : null}
          {item.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {item.error_message ? <p>{item.error_message}</p> : null}
        </section>
      ) : null}
    </aside>
  );
}
