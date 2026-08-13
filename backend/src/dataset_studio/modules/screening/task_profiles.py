from __future__ import annotations

import re
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass, replace

from dataset_studio.modules.screening.models import (
    CHARACTER_LORA_PROFILE_VERSION,
    CharacterLoraRules,
    ScreeningTaskProfile,
    ScreeningTaskProfileSelection,
    ScreeningTaskProfileSnapshot,
)

FIT_FACTORS = {
    "comic_panel": 0.20,
    "multiple_views": 0.20,
    "monochrome_greyscale": 0.30,
    "lineart_sketch": 0.20,
    "crowd_3": 0.55,
    "crowd_4_to_5": 0.35,
    "crowd_6_plus": 0.20,
    "minimum": 0.05,
}

COMIC_PANEL_TAGS = frozenset(
    {
        "comic",
        "1koma",
        "2koma",
        "3koma",
        "4koma",
        "5koma",
        "6koma",
        "full_page_comic",
        "silent_comic",
        "segmented_comic",
        "borderless_panels",
        "panel_layout",
        "webtoon",
    }
)
MULTIPLE_VIEW_TAGS = frozenset(
    {"multiple_views", "character_sheet", "reference_sheet", "turnaround"}
)
MONOCHROME_TAGS = frozenset({"monochrome", "greyscale"})
LINEWORK_TAGS = frozenset({"lineart", "sketch"})
PEOPLE_COUNT_PATTERN = re.compile(r"^(\d+)(?:\+)?(girls?|boys?|others?)$")


@dataclass(frozen=True, slots=True)
class TaskProfileInput:
    item_id: str
    asset_id: str
    source_relative_path: str
    rating: str
    quality_score: float
    task_tags: tuple[str, ...] | None
    confidence_pop: float = 0.5
    bad_consensus_second: float = 0.0


@dataclass(frozen=True, slots=True)
class TaskProfileOutput:
    item_id: str
    task_fit_score: float | None
    selection_score: float | None
    selection_rank: int | None = None
    selection_percentile: float | None = None
    reason_codes: tuple[str, ...] = ()
    matched_tags: tuple[str, ...] = ()
    candidate_pool: str | None = None


def profile_snapshot(selection: ScreeningTaskProfileSelection) -> ScreeningTaskProfileSnapshot:
    return ScreeningTaskProfileSnapshot(
        profile_id=ScreeningTaskProfile.CHARACTER_LORA,
        profile_version=CHARACTER_LORA_PROFILE_VERSION,
        rules=selection.task_rules,
        fit_factors=dict(FIT_FACTORS),
    )


def evaluate_task_profile(
    items: list[TaskProfileInput],
    rules: CharacterLoraRules,
) -> list[TaskProfileOutput]:
    staged = [_evaluate_item(item, rules) for item in items]
    eligible_by_rating: dict[str, list[tuple[TaskProfileInput, TaskProfileOutput]]] = defaultdict(
        list
    )
    inputs = {item.item_id: item for item in items}
    for output in staged:
        if output.selection_score is not None:
            eligible_by_rating[inputs[output.item_id].rating].append(
                (inputs[output.item_id], output)
            )

    ranked: dict[str, TaskProfileOutput] = {}
    for group in eligible_by_rating.values():
        values = {output.item_id: float(output.selection_score) for _, output in group}
        percentiles = _midrank_values(values)
        ordered = sorted(
            group,
            key=lambda pair: (
                -float(pair[1].selection_score),
                pair[0].source_relative_path.casefold(),
                pair[0].asset_id,
            ),
        )
        previous_score: float | None = None
        display_rank = 1
        for index, (_, output) in enumerate(ordered):
            current = float(output.selection_score)
            if previous_score is not None and current != previous_score:
                display_rank = index + 1
            previous_score = current
            ranked[output.item_id] = replace(
                output,
                selection_rank=display_rank,
                selection_percentile=percentiles[output.item_id],
            )

    return [ranked.get(output.item_id, output) for output in staged]


def _evaluate_item(item: TaskProfileInput, rules: CharacterLoraRules) -> TaskProfileOutput:
    if item.task_tags is None:
        if not any(rules.model_dump().values()):
            return TaskProfileOutput(
                item_id=item.item_id,
                task_fit_score=1.0,
                selection_score=item.quality_score,
            )
        return TaskProfileOutput(
            item_id=item.item_id,
            task_fit_score=None,
            selection_score=None,
            reason_codes=("TASK_TAGS_UNAVAILABLE",),
        )

    tags = set(item.task_tags)
    visual_factors = [1.0]
    reasons: list[str] = []
    matched: set[str] = set()

    _match_visual_rule(
        enabled=rules.comic_panel,
        tags=tags,
        family=COMIC_PANEL_TAGS,
        factor=FIT_FACTORS["comic_panel"],
        reason="TASK_COMIC_PANEL",
        visual_factors=visual_factors,
        reasons=reasons,
        matched=matched,
    )
    _match_visual_rule(
        enabled=rules.multiple_views,
        tags=tags,
        family=MULTIPLE_VIEW_TAGS,
        factor=FIT_FACTORS["multiple_views"],
        reason="TASK_MULTIPLE_VIEWS",
        visual_factors=visual_factors,
        reasons=reasons,
        matched=matched,
    )
    _match_visual_rule(
        enabled=rules.monochrome_greyscale,
        tags=tags,
        family=MONOCHROME_TAGS,
        factor=FIT_FACTORS["monochrome_greyscale"],
        reason="TASK_MONOCHROME_GREYSCALE",
        visual_factors=visual_factors,
        reasons=reasons,
        matched=matched,
    )
    _match_visual_rule(
        enabled=rules.lineart_sketch,
        tags=tags,
        family=LINEWORK_TAGS,
        factor=FIT_FACTORS["lineart_sketch"],
        reason="TASK_LINEART_SKETCH",
        visual_factors=visual_factors,
        reasons=reasons,
        matched=matched,
    )

    crowd_factor = 1.0
    people_count, people_tags = _people_count(tags)
    if rules.crowd_3plus and people_count >= 3:
        if people_count >= 6:
            crowd_factor = FIT_FACTORS["crowd_6_plus"]
        elif people_count >= 4:
            crowd_factor = FIT_FACTORS["crowd_4_to_5"]
        else:
            crowd_factor = FIT_FACTORS["crowd_3"]
        reasons.append("TASK_CROWD_3PLUS")
        matched.update(people_tags)

    task_fit = max(FIT_FACTORS["minimum"], min(visual_factors) * crowd_factor)
    return TaskProfileOutput(
        item_id=item.item_id,
        task_fit_score=task_fit,
        selection_score=max(0.0, min(1.0, item.quality_score * task_fit)),
        reason_codes=tuple(reasons),
        matched_tags=tuple(sorted(matched)),
    )


def _match_visual_rule(
    *,
    enabled: bool,
    tags: set[str],
    family: frozenset[str],
    factor: float,
    reason: str,
    visual_factors: list[float],
    reasons: list[str],
    matched: set[str],
) -> None:
    if not enabled:
        return
    hits = tags & family
    if not hits:
        return
    visual_factors.append(factor)
    reasons.append(reason)
    matched.update(hits)


def _people_count(tags: set[str]) -> tuple[int, set[str]]:
    counts = {"girl": 0, "boy": 0, "other": 0}
    matched: set[str] = set()
    for tag in tags:
        match = PEOPLE_COUNT_PATTERN.fullmatch(tag)
        if match is None:
            continue
        category = match.group(2)
        if category.startswith("girl"):
            key = "girl"
        elif category.startswith("boy"):
            key = "boy"
        else:
            key = "other"
        value = int(match.group(1))
        if value > counts[key]:
            counts[key] = value
        matched.add(tag)
    return sum(counts.values()), matched


def _midrank_values(values: dict[str, float]) -> dict[str, float]:
    ordered = sorted(values.values())
    total = len(ordered)
    result: dict[str, float] = {}
    for item_id, value in values.items():
        less = bisect_left(ordered, value)
        equal = bisect_right(ordered, value) - less
        result[item_id] = (less + 0.5 * equal) / total
    return result
