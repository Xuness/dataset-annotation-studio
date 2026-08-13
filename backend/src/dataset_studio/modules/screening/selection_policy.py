from __future__ import annotations

from collections import Counter
from dataclasses import replace

from dataset_studio.modules.screening.models import (
    ScreeningCandidatePool,
    ScreeningIntensity,
)
from dataset_studio.modules.screening.task_profiles import TaskProfileInput, TaskProfileOutput


def apply_selection_policy(
    items: list[TaskProfileInput],
    outputs: list[TaskProfileOutput],
    *,
    intensity: ScreeningIntensity,
) -> list[TaskProfileOutput]:
    thresholds = {
        ScreeningIntensity.CONSERVATIVE: (0.95, 0.70, 0.20),
        ScreeningIntensity.BALANCED: (0.90, 0.60, 0.30),
        ScreeningIntensity.AGGRESSIVE: (0.85, 0.50, 0.40),
    }[intensity]
    elite_threshold, recommended_threshold, low_threshold = thresholds
    inputs = {item.item_id: item for item in items}
    cohort_sizes = Counter(
        inputs[output.item_id].rating
        for output in outputs
        if output.selection_percentile is not None
    )

    assigned: list[TaskProfileOutput] = []
    for output in outputs:
        item = inputs[output.item_id]
        reasons = list(output.reason_codes)
        percentile = output.selection_percentile
        if output.task_fit_score is not None and output.task_fit_score <= 0.35:
            pool = ScreeningCandidatePool.TASK_MISMATCH
            reasons.append("TASK_MISMATCH_STRONG_PENALTY")
        elif item.confidence_pop < 0.5:
            pool = ScreeningCandidatePool.LOW_EVIDENCE
        elif percentile is None:
            pool = ScreeningCandidatePool.REVIEW
            reasons.append("TASK_FIT_UNAVAILABLE_REVIEW")
        elif cohort_sizes[item.rating] < 20:
            pool = ScreeningCandidatePool.REVIEW
            reasons.append("SMALL_TASK_RATING_COHORT_REVIEW")
        elif percentile >= elite_threshold:
            pool = ScreeningCandidatePool.ELITE
        elif percentile >= recommended_threshold:
            pool = ScreeningCandidatePool.RECOMMENDED
        elif (
            percentile <= low_threshold
            and item.confidence_pop >= 0.67
            and item.bad_consensus_second >= 0.5
        ):
            pool = ScreeningCandidatePool.LOW_PRIORITY
            reasons.append("TASK_HIGH_CONFIDENCE_LOW_PRIORITY")
        else:
            pool = ScreeningCandidatePool.REVIEW
        assigned.append(replace(output, candidate_pool=pool.value, reason_codes=tuple(reasons)))
    return assigned
