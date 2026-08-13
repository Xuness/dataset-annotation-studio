from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, replace

from dataset_studio.modules.screening.metadata import NormalizedMetadata
from dataset_studio.modules.screening.models import (
    ScreeningCandidatePool,
    ScreeningIntensity,
)

K_BY_RATING_AGE: dict[str, dict[str, int]] = {
    "g": dict(
        zip(
            (
                "lt6h",
                "6h_24h",
                "1d_3d",
                "3d_7d",
                "7d_30d",
                "30d_90d",
                "90d_1y",
                "1y_3y",
                "3y_10y",
                "gte10y",
            ),
            (2, 4, 4, 5, 6, 7, 8, 14, 21, 21),
            strict=True,
        )
    ),
    "s": dict(
        zip(
            (
                "lt6h",
                "6h_24h",
                "1d_3d",
                "3d_7d",
                "7d_30d",
                "30d_90d",
                "90d_1y",
                "1y_3y",
                "3y_10y",
                "gte10y",
            ),
            (6, 13, 15, 17, 22, 25, 33, 52, 52, 52),
            strict=True,
        )
    ),
    "q": dict(
        zip(
            (
                "lt6h",
                "6h_24h",
                "1d_3d",
                "3d_7d",
                "7d_30d",
                "30d_90d",
                "90d_1y",
                "1y_3y",
                "3y_10y",
                "gte10y",
            ),
            (9, 20, 23, 26, 41, 53, 74, 112, 112, 112),
            strict=True,
        )
    ),
    "e": dict(
        zip(
            (
                "lt6h",
                "6h_24h",
                "1d_3d",
                "3d_7d",
                "7d_30d",
                "30d_90d",
                "90d_1y",
                "1y_3y",
                "3y_10y",
                "gte10y",
            ),
            (8, 21, 24, 31, 45, 67, 94, 152, 159, 159),
            strict=True,
        )
    ),
}

BETA_PRIORS = {
    "g": (5.23864, 0.05219),
    "s": (13.72586, 0.09322),
    "q": (15.78102, 0.12036),
    "e": (14.41201, 0.16356),
}

KEEP_WEIGHTS = {
    "g": (0.72, 0.14, 0.10, 0.04),
    "s": (0.72, 0.12, 0.12, 0.04),
    "q": (0.71, 0.10, 0.15, 0.04),
    "e": (0.70, 0.08, 0.18, 0.04),
}

# Artist rescue and the Beta lower-bound signal are deliberately disabled in
# batch-only v0.1. Their original weights are not silently redistributed.
ELITE_WEIGHTS = {
    "g": (0.48, 0.20, 0.10, 0.10, 0.12),
    "s": (0.50, 0.17, 0.13, 0.08, 0.12),
    "q": (0.52, 0.13, 0.17, 0.06, 0.12),
    "e": (0.52, 0.11, 0.20, 0.05, 0.12),
}


@dataclass(frozen=True, slots=True)
class ScoringInput:
    item_id: str
    asset_id: str
    source_relative_path: str
    image_hash: str | None
    width: int | None
    height: int | None
    metadata: NormalizedMetadata


@dataclass(frozen=True, slots=True)
class ScoringOutput:
    item_id: str
    asset_id: str
    source_relative_path: str
    image_hash: str | None
    rating: str
    confidence_pop: float
    confidence_depth: float
    confidence_vote: float
    technical_score: float
    keep_score: float
    elite_score: float
    final_score: float
    rating_rank: int
    rating_percentile: float
    candidate_pool: str
    low_resolution_flag: bool
    pixel_duplicate_group: str | None
    variant_group: str | None
    duplicate_representative: bool
    duplicate_of_asset_id: str | None
    score_details: dict[str, float | None]
    reason_codes: tuple[str, ...]


def score_batch(
    items: list[ScoringInput],
    *,
    intensity: ScreeningIntensity,
) -> list[ScoringOutput]:
    if not items:
        return []
    pop_values = {
        item.item_id: 0.5
        * (math.log1p(item.metadata.fav_count) + math.log1p(item.metadata.up_score))
        for item in items
    }
    pop_raw = _fallback_group_midrank(
        items,
        pop_values,
        keys=(
            lambda item: (item.metadata.rating, item.metadata.age_bucket),
            lambda item: item.metadata.rating,
        ),
    )

    depth_values = {item.item_id: math.log1p(item.metadata.fav_count) for item in items}
    depth_raw = _depth_midrank(items, depth_values)

    vote_means: dict[str, float] = {}
    vote_eligible: list[ScoringInput] = []
    for item in items:
        if item.metadata.downvote_count is None:
            continue
        alpha, beta = BETA_PRIORS[item.metadata.rating]
        vote_means[item.item_id] = (item.metadata.up_score + alpha) / (
            item.metadata.up_score + item.metadata.downvote_count + alpha + beta
        )
        vote_eligible.append(item)
    vote_raw = _fallback_group_midrank(
        vote_eligible,
        vote_means,
        keys=(
            lambda item: (
                item.metadata.rating,
                item.metadata.age_bucket,
                up_bucket(item.metadata.vote_evidence or 0),
            ),
            lambda item: (
                item.metadata.rating,
                up_bucket(item.metadata.vote_evidence or 0),
            ),
            lambda item: item.metadata.rating,
        ),
    )

    staged: list[ScoringOutput] = []
    for item in items:
        metadata = item.metadata
        k = K_BY_RATING_AGE[metadata.rating][metadata.age_bucket]
        half_k = math.ceil(k / 2)
        confidence_pop = metadata.evidence_mass / (metadata.evidence_mass + k)
        confidence_depth = metadata.up_score / (metadata.up_score + half_k)
        confidence_vote = (
            metadata.vote_evidence / (metadata.vote_evidence + half_k)
            if metadata.vote_evidence is not None
            else 0.0
        )
        popularity = _shrink(pop_raw[item.item_id], confidence_pop)
        depth = _shrink(depth_raw[item.item_id], confidence_depth)
        if metadata.downvote_count is None:
            vote_mean = None
            vote = 0.5
        else:
            vote_mean = vote_means[item.item_id]
            vote = _shrink(vote_raw[item.item_id], confidence_vote)
        vote_keep = _clip(0.5 + 0.35 * max(vote - 0.5, 0) + 1.20 * min(vote - 0.5, 0))
        technical, dimensions_missing = _technical_score(item.width, item.height)
        low_resolution = (
            item.width is not None
            and item.height is not None
            and item.width > 0
            and item.height > 0
            and min(item.width, item.height) < 768
        )

        bad_pop = _bad(popularity, confidence_pop)
        bad_depth = _bad(depth, confidence_depth)
        bad_vote = _bad(vote, confidence_vote) if metadata.downvote_count is not None else 0.0
        bad_second = sorted((bad_pop, bad_depth, bad_vote), reverse=True)[1]
        wp, wd, wv, wt = KEEP_WEIGHTS[metadata.rating]
        keep = _clip(
            wp * popularity + wd * depth + wv * vote_keep + wt * technical - 0.08 * bad_second
        )

        tail_pop = _tail(popularity)
        tail_depth = _tail(depth)
        # Beta lower and Artist are explicit neutral signals in this score mode.
        tail_vote_lower = 0.0
        tail_artist = 0.0
        consistency_second = sorted((tail_pop, tail_depth, tail_vote_lower), reverse=True)[1]
        ep, ed, ev, ea, ec = ELITE_WEIGHTS[metadata.rating]
        elite = (
            ep * tail_pop
            + ed * tail_depth
            + ev * tail_vote_lower
            + ea * tail_artist
            + ec * consistency_second
        )
        gate_x = _clip((keep - 0.55) / 0.20)
        gate = gate_x * gate_x * (3 - 2 * gate_x)
        final = _clip(keep + (1 - keep) * 0.55 * gate * elite)

        reasons: list[str] = []
        if confidence_pop < 0.5:
            reasons.append("LOW_EVIDENCE")
        if popularity >= 0.80:
            reasons.append("STRONG_POPULARITY")
        if depth >= 0.80:
            reasons.append("DEEP_FAVORITE_SIGNAL")
        if vote < 0.25 and confidence_vote >= 0.67:
            reasons.append("NEGATIVE_VOTE_SIGNAL")
        if metadata.downvote_count is None:
            reasons.append("VOTE_NEUTRAL_MISSING_DOWN_SCORE")
        if dimensions_missing:
            reasons.append("DIMENSIONS_MISSING_TECH_NEUTRAL")
        elif low_resolution:
            reasons.append("LOW_RESOLUTION")

        variant_group = metadata.parent_id
        if variant_group is None and metadata.has_children:
            variant_group = metadata.post_id
        staged.append(
            ScoringOutput(
                item_id=item.item_id,
                asset_id=item.asset_id,
                source_relative_path=item.source_relative_path,
                image_hash=item.image_hash,
                rating=metadata.rating,
                confidence_pop=confidence_pop,
                confidence_depth=confidence_depth,
                confidence_vote=confidence_vote,
                technical_score=technical,
                keep_score=keep,
                elite_score=elite,
                final_score=final,
                rating_rank=0,
                rating_percentile=0.5,
                candidate_pool=ScreeningCandidatePool.REVIEW.value,
                low_resolution_flag=low_resolution,
                pixel_duplicate_group=metadata.pixel_hash,
                variant_group=variant_group,
                duplicate_representative=True,
                duplicate_of_asset_id=None,
                score_details={
                    "popularity_percentile_raw": pop_raw[item.item_id],
                    "popularity_percentile_final": popularity,
                    "depth_percentile_raw": depth_raw[item.item_id],
                    "depth_percentile_final": depth,
                    "vote_posterior_mean": vote_mean,
                    "vote_posterior_lower_95": None,
                    "vote_percentile_mean": (vote if metadata.downvote_count is not None else None),
                    "vote_percentile_lower": None,
                    "vote_keep_signal": vote_keep,
                    "bad_pop": bad_pop,
                    "bad_depth": bad_depth,
                    "bad_vote": bad_vote,
                    "bad_consensus_second": bad_second,
                },
                reason_codes=tuple(reasons),
            )
        )

    staged = _assign_ranks_and_pools(staged, intensity=intensity)
    return _mark_duplicates(staged)


def _assign_ranks_and_pools(
    outputs: list[ScoringOutput],
    *,
    intensity: ScreeningIntensity,
) -> list[ScoringOutput]:
    thresholds = {
        ScreeningIntensity.CONSERVATIVE: (0.95, 0.70, 0.20),
        ScreeningIntensity.BALANCED: (0.90, 0.60, 0.30),
        ScreeningIntensity.AGGRESSIVE: (0.85, 0.50, 0.40),
    }[intensity]
    elite_threshold, recommended_threshold, low_threshold = thresholds
    by_rating: dict[str, list[ScoringOutput]] = defaultdict(list)
    for output in outputs:
        by_rating[output.rating].append(output)

    assigned: dict[str, ScoringOutput] = {}
    for group in by_rating.values():
        percentiles = _midrank_values({output.item_id: output.final_score for output in group})
        ordered = sorted(
            group,
            key=lambda output: (
                -output.final_score,
                output.source_relative_path.casefold(),
                output.asset_id,
            ),
        )
        small_group = len(group) < 20
        previous_score: float | None = None
        display_rank = 1
        for index, output in enumerate(ordered):
            if previous_score is not None and not math.isclose(
                output.final_score,
                previous_score,
                rel_tol=1e-12,
                abs_tol=1e-12,
            ):
                display_rank = index + 1
            previous_score = output.final_score
            rank = display_rank
            percentile = percentiles[output.item_id]
            reasons = list(output.reason_codes)
            if output.confidence_pop < 0.5:
                pool = ScreeningCandidatePool.LOW_EVIDENCE
            elif small_group:
                pool = ScreeningCandidatePool.REVIEW
                reasons.append("SMALL_RATING_COHORT_REVIEW")
            elif percentile >= elite_threshold and output.confidence_pop >= 0.5:
                pool = ScreeningCandidatePool.ELITE
            elif percentile >= recommended_threshold:
                pool = ScreeningCandidatePool.RECOMMENDED
            elif (
                not small_group
                and percentile <= low_threshold
                and output.confidence_pop >= 0.67
                and output.score_details["bad_consensus_second"] is not None
                and float(output.score_details["bad_consensus_second"]) >= 0.5
            ):
                pool = ScreeningCandidatePool.LOW_PRIORITY
                reasons.append("HIGH_CONFIDENCE_LOW_PRIORITY")
            else:
                pool = ScreeningCandidatePool.REVIEW
            assigned[output.item_id] = replace(
                output,
                rating_rank=rank,
                rating_percentile=percentile,
                candidate_pool=pool.value,
                reason_codes=tuple(reasons),
            )
    return [assigned[output.item_id] for output in outputs]


def _mark_duplicates(outputs: list[ScoringOutput]) -> list[ScoringOutput]:
    parents = {output.item_id: output.item_id for output in outputs}
    first_by_key: dict[str, str] = {}

    def find(item_id: str) -> str:
        while parents[item_id] != item_id:
            parents[item_id] = parents[parents[item_id]]
            item_id = parents[item_id]
        return item_id

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for output in outputs:
        keys: list[str] = []
        if output.image_hash:
            keys.append(f"content:{output.image_hash}")
        if output.pixel_duplicate_group:
            keys.append(f"pixel:{output.pixel_duplicate_group}")
        for key in keys:
            first = first_by_key.setdefault(key, output.item_id)
            union(first, output.item_id)

    groups: dict[str, list[ScoringOutput]] = defaultdict(list)
    for output in outputs:
        groups[find(output.item_id)].append(output)

    duplicates: dict[str, tuple[bool, str, str]] = {}
    for group in groups.values():
        if len(group) < 2:
            continue
        representative = min(
            group,
            key=lambda item: (
                -item.final_score,
                item.source_relative_path.casefold(),
                item.asset_id,
            ),
        )
        pixel_hashes = sorted(
            {output.pixel_duplicate_group for output in group if output.pixel_duplicate_group}
        )
        group_hash = (
            f"pixel:{pixel_hashes[0]}" if pixel_hashes else f"content:{representative.image_hash}"
        )
        for output in group:
            duplicates[output.item_id] = (
                output.item_id == representative.item_id,
                group_hash,
                representative.asset_id,
            )
    marked: list[ScoringOutput] = []
    for output in outputs:
        duplicate = duplicates.get(output.item_id)
        if duplicate is None:
            marked.append(replace(output, pixel_duplicate_group=None))
            continue
        representative, group_hash, representative_asset_id = duplicate
        reasons = list(output.reason_codes)
        reasons.append(
            "PIXEL_DUPLICATE_REPRESENTATIVE" if representative else "PIXEL_DUPLICATE_VARIANT"
        )
        marked.append(
            replace(
                output,
                pixel_duplicate_group=group_hash,
                duplicate_representative=representative,
                duplicate_of_asset_id=None if representative else representative_asset_id,
                reason_codes=tuple(reasons),
            )
        )
    return marked


def _fallback_group_midrank(
    items: list[ScoringInput],
    values: dict[str, float],
    *,
    keys: tuple,
) -> dict[str, float]:
    if not items:
        return {}
    levels: list[dict[object, list[ScoringInput]]] = []
    for key in keys:
        groups: dict[object, list[ScoringInput]] = defaultdict(list)
        for item in items:
            groups[key(item)].append(item)
        levels.append(groups)
    result: dict[str, float] = {}
    rank_cache: dict[tuple[int, object], dict[str, float]] = {}
    for item in items:
        for level_index, (level, key) in enumerate(zip(levels, keys, strict=True)):
            group_key = key(item)
            cohort = level[group_key]
            if len(cohort) >= 20 or level is levels[-1]:
                cache_key = (level_index, group_key)
                ranks = rank_cache.get(cache_key)
                if ranks is None:
                    ranks = _midrank_values(
                        {entry.item_id: values[entry.item_id] for entry in cohort}
                    )
                    rank_cache[cache_key] = ranks
                result[item.item_id] = ranks[item.item_id]
                break
    return result


def _depth_midrank(
    items: list[ScoringInput],
    values: dict[str, float],
) -> dict[str, float]:
    return _fallback_group_midrank(
        items,
        values,
        keys=(
            lambda item: (
                item.metadata.rating,
                item.metadata.age_bucket,
                up_bucket(item.metadata.up_score),
            ),
            lambda item: (item.metadata.rating, up_bucket(item.metadata.up_score)),
            lambda item: item.metadata.rating,
        ),
    )


def _midrank_values(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values.items(), key=lambda entry: (entry[1], entry[0]))
    total = len(ordered)
    result: dict[str, float] = {}
    start = 0
    while start < total:
        end = start + 1
        while end < total and math.isclose(
            ordered[end][1], ordered[start][1], rel_tol=1e-12, abs_tol=1e-12
        ):
            end += 1
        percentile = (start + 0.5 * (end - start)) / total
        for index in range(start, end):
            result[ordered[index][0]] = percentile
        start = end
    return result


def up_bucket(up_score: int) -> str:
    if up_score <= 2:
        return str(up_score)
    boundaries = (
        (4, "3_4"),
        (9, "5_9"),
        (19, "10_19"),
        (49, "20_49"),
        (99, "50_99"),
        (199, "100_199"),
        (499, "200_499"),
    )
    for upper, name in boundaries:
        if up_score <= upper:
            return name
    return "gte500"


def _shrink(percentile: float, confidence: float) -> float:
    return 0.5 + confidence * (percentile - 0.5)


def _bad(percentile: float, confidence: float) -> float:
    if confidence < 0.67:
        return 0.0
    return _clip((0.25 - percentile) / 0.25)


def _tail(percentile: float) -> float:
    if percentile <= 0.88:
        return 0.0
    return ((percentile - 0.88) / 0.12) ** 1.5


def _technical_score(width: int | None, height: int | None) -> tuple[float, bool]:
    if width is None or height is None or width <= 0 or height <= 0:
        return 0.5, True
    short_side = min(width, height)
    x = _clip((math.log(short_side) - math.log(768)) / (math.log(1536) - math.log(768)))
    return x * x * (3 - 2 * x), False


def _clip(value: float) -> float:
    return min(max(value, 0.0), 1.0)
