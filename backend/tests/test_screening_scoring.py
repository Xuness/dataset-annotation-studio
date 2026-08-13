from __future__ import annotations

import pytest

from dataset_studio.modules.screening.metadata import (
    MetadataReadError,
    NormalizedMetadata,
    age_bucket,
    normalize_metadata,
)
from dataset_studio.modules.screening.models import ScreeningIntensity
from dataset_studio.modules.screening.scoring import (
    K_BY_RATING_AGE,
    ScoringInput,
    _bad,
    _midrank_values,
    _shrink,
    _tail,
    _technical_score,
    score_batch,
    up_bucket,
)


def _metadata(
    *,
    rating: str = "g",
    fav: int = 4,
    up: int = 3,
    down: int | None = 0,
    bucket: str = "7d_30d",
    pixel_hash: str | None = None,
) -> NormalizedMetadata:
    evidence = fav + up + (down or 0)
    return NormalizedMetadata(
        rating=rating,
        created_at="2026-01-01T00:00:00Z",
        metadata_snapshot_at="2026-01-10T00:00:00Z",
        age_hours=216.0,
        age_bucket=bucket,
        fav_count=fav,
        up_score=up,
        downvote_count=down,
        evidence_mass=evidence,
        vote_evidence=up + down if down is not None else None,
        disposition="valid",
        post_id=None,
        parent_id=None,
        has_children=False,
        pixel_hash=pixel_hash,
        warnings=(),
    )


def _input(
    item_id: str,
    metadata: NormalizedMetadata,
    *,
    image_hash: str | None = None,
    width: int | None = 1536,
    height: int | None = 1536,
) -> ScoringInput:
    return ScoringInput(
        item_id=item_id,
        asset_id=f"asset-{item_id}",
        source_relative_path=f"{item_id}.png",
        image_hash=image_hash,
        width=width,
        height=height,
        metadata=metadata,
    )


def test_metadata_normalizes_signed_down_and_keeps_missing_vote_unavailable() -> None:
    base = {
        "rating": "general",
        "created_at": "2026-01-01T00:00:00Z",
        "fav_count": -3,
        "up_score": "4",
    }
    signed = normalize_metadata(
        base | {"down_score": -2},
        fallback_snapshot_at="2026-01-02T00:00:00Z",
    )
    missing = normalize_metadata(
        base,
        fallback_snapshot_at="2026-01-02T00:00:00Z",
    )

    assert (signed.fav_count, signed.up_score, signed.downvote_count) == (0, 4, 2)
    assert signed.evidence_mass == 6
    assert missing.downvote_count is None
    assert missing.vote_evidence is None
    assert "DOWN_SCORE_MISSING_VOTE_NEUTRAL" in missing.warnings


def test_metadata_rejects_missing_required_fields_and_naive_timestamps() -> None:
    with pytest.raises(MetadataReadError, match="fav_count"):
        normalize_metadata(
            {
                "rating": "g",
                "created_at": "2026-01-01T00:00:00Z",
                "up_score": 1,
            },
            fallback_snapshot_at="2026-01-02T00:00:00Z",
        )
    with pytest.raises(MetadataReadError, match="必须包含时区"):
        normalize_metadata(
            {
                "rating": "g",
                "created_at": "2026-01-01 00:00:00",
                "fav_count": 1,
                "up_score": 1,
            },
            fallback_snapshot_at="2026-01-02T00:00:00Z",
        )


def test_metadata_reads_nested_media_asset_fields_from_real_sidecar_shape() -> None:
    metadata = normalize_metadata(
        {
            "id": 10_430_386,
            "rating": "g",
            "created_at": "2026-01-01T00:00:00Z",
            "fav_count": 12,
            "up_score": 10,
            "down_score": -1,
            "media_asset": {
                "pixel_hash": "frozen-pixel-hash",
                "is_public": False,
                "status": "active",
            },
        },
        fallback_snapshot_at="2026-01-02T00:00:00Z",
    )

    assert metadata.post_id == "10430386"
    assert metadata.pixel_hash == "frozen-pixel-hash"
    assert metadata.disposition == "invalid"


def test_metadata_evidence_mass_includes_downvotes_only_when_available() -> None:
    base = {
        "rating": "g",
        "created_at": "2026-01-01T00:00:00Z",
        "fav_count": 2,
        "up_score": 3,
    }
    with_down = normalize_metadata(
        base | {"down_score": -7},
        fallback_snapshot_at="2026-01-02T00:00:00Z",
    )
    without_down = normalize_metadata(
        base,
        fallback_snapshot_at="2026-01-02T00:00:00Z",
    )

    assert with_down.evidence_mass == 12
    assert without_down.evidence_mass == 5


def test_metadata_rejects_conflicting_signed_and_explicit_downvotes() -> None:
    with pytest.raises(MetadataReadError) as raised:
        normalize_metadata(
            {
                "rating": "g",
                "created_at": "2026-01-01T00:00:00Z",
                "fav_count": 2,
                "up_score": 3,
                "down_score": -9,
                "downvote_count": 1,
            },
            fallback_snapshot_at="2026-01-02T00:00:00Z",
        )

    assert raised.value.code == "DOWN_SCORE_CONFLICT"


def test_metadata_prefers_complement_pipeline_snapshot_proxy_over_file_mtime() -> None:
    metadata = normalize_metadata(
        {
            "rating": "g",
            "created_at": "2026-06-01T00:00:00Z",
            "pipeline_plan_created_at": "2026-06-02T00:00:00Z",
            "fav_count": 2,
            "up_score": 3,
            "down_score": 0,
        },
        fallback_snapshot_at=None,
        file_snapshot_at="2026-08-13T00:00:00Z",
    )

    assert metadata.metadata_snapshot_at == "2026-06-02T00:00:00Z"
    assert metadata.age_hours == 24
    assert metadata.age_bucket == "1d_3d"
    assert "SNAPSHOT_FROM_PIPELINE_PLAN_PROXY" in metadata.warnings
    assert "SNAPSHOT_FROM_SIDECAR_MTIME" not in metadata.warnings


@pytest.mark.parametrize(
    ("hours", "expected"),
    [
        (6, "6h_24h"),
        (24, "1d_3d"),
        (3 * 24, "3d_7d"),
        (7 * 24, "7d_30d"),
        (30 * 24, "30d_90d"),
        (90 * 24, "90d_1y"),
        (365 * 24, "1y_3y"),
        (3 * 365 * 24, "3y_10y"),
        (10 * 365 * 24, "gte10y"),
    ],
)
def test_age_buckets_are_right_open_at_documented_boundaries(hours: float, expected: str) -> None:
    assert age_bucket(hours) == expected
    assert all(expected in table for table in K_BY_RATING_AGE.values())


def test_rank_shrink_bad_tail_and_technical_boundaries() -> None:
    assert _midrank_values({"a": 0, "b": 1, "c": 1, "d": 3}) == pytest.approx(
        {"a": 0.125, "b": 0.5, "c": 0.5, "d": 0.875}
    )
    assert _midrank_values({"a": 1, "b": 1}) == {"a": 0.5, "b": 0.5}
    assert _shrink(0.9, 0.0) == pytest.approx(0.5)
    assert _shrink(0.9, 0.5) == pytest.approx(0.7)
    assert _bad(0.0, 2 / 3) == 0.0
    assert _bad(0.0, 0.67) == 1.0
    assert _tail(0.88) == 0.0
    assert _tail(0.90) == pytest.approx(0.0680413817)
    assert _technical_score(768, 2048) == pytest.approx((0.0, False))
    assert _technical_score(1536, 1536) == pytest.approx((1.0, False))
    assert _technical_score(None, 1536) == (0.5, True)


def test_k_table_is_locked_to_the_calibrated_document_values() -> None:
    assert list(K_BY_RATING_AGE["g"].values()) == [2, 4, 4, 5, 6, 7, 8, 14, 21, 21]
    assert list(K_BY_RATING_AGE["s"].values()) == [6, 13, 15, 17, 22, 25, 33, 52, 52, 52]
    assert list(K_BY_RATING_AGE["q"].values()) == [9, 20, 23, 26, 41, 53, 74, 112, 112, 112]
    assert list(K_BY_RATING_AGE["e"].values()) == [8, 21, 24, 31, 45, 67, 94, 152, 159, 159]


def test_zero_explicit_votes_are_neutral_despite_the_beta_prior() -> None:
    output = score_batch(
        [_input("zero-vote", _metadata(fav=0, up=0, down=0))],
        intensity=ScreeningIntensity.BALANCED,
    )[0]

    assert output.score_details["vote_posterior_mean"] == pytest.approx(0.9901364)
    assert output.confidence_vote == 0
    assert output.score_details["vote_percentile_mean"] == pytest.approx(0.5)
    assert output.score_details["vote_posterior_lower_95"] is None
    assert output.score_details["vote_percentile_lower"] is None


def test_twenty_item_rating_cohort_enables_automatic_candidate_pools() -> None:
    items = [
        _input(str(index), _metadata(fav=100 + index * index, up=100 + index, down=0))
        for index in range(20)
    ]
    outputs = score_batch(items, intensity=ScreeningIntensity.BALANCED)

    assert not any("SMALL_RATING_COHORT_REVIEW" in output.reason_codes for output in outputs)
    assert any(output.candidate_pool == "elite_candidate" for output in outputs)
    assert any(output.candidate_pool == "recommended" for output in outputs)
    assert any(output.candidate_pool == "low_priority_high_confidence" for output in outputs)


def test_batch_scoring_is_rating_local_and_missing_down_stays_neutral() -> None:
    items = [
        _input("g-low", _metadata(fav=0, up=0, down=None)),
        _input("g-high", _metadata(fav=100, up=80, down=0)),
        _input("s-only", _metadata(rating="s", fav=10_000, up=10_000, down=0)),
    ]
    outputs = {
        item.item_id: item for item in score_batch(items, intensity=ScreeningIntensity.BALANCED)
    }

    assert outputs["g-low"].score_details["popularity_percentile_raw"] == pytest.approx(0.25)
    assert outputs["g-high"].score_details["popularity_percentile_raw"] == pytest.approx(0.75)
    assert outputs["s-only"].score_details["popularity_percentile_raw"] == pytest.approx(0.5)
    assert outputs["g-low"].confidence_vote == 0.0
    assert outputs["g-low"].score_details["vote_posterior_mean"] is None
    assert outputs["g-low"].score_details["vote_percentile_mean"] is None
    assert outputs["g-low"].candidate_pool == "low_evidence_protected"


def test_metadata_read_batches_do_not_partition_the_rating_cdf() -> None:
    item_count = 600
    items = [
        _input(
            str(index),
            _metadata(fav=100 + index, up=100 + index, down=0),
        )
        for index in range(item_count)
    ]
    outputs = {
        output.item_id: output
        for output in score_batch(items, intensity=ScreeningIntensity.BALANCED)
    }

    # Metadata I/O may be committed in bounded batches, but ranking must still
    # use the complete valid Rating cohort. These two items straddle the
    # worker's 512-item write boundary and therefore must not restart at 0/1.
    assert outputs["511"].score_details["popularity_percentile_raw"] == pytest.approx(
        511.5 / item_count
    )
    assert outputs["512"].score_details["popularity_percentile_raw"] == pytest.approx(
        512.5 / item_count
    )


def test_batch_scoring_is_deterministic_under_input_permutation() -> None:
    ratings = ("g", "s", "q", "e")
    buckets = ("lt6h", "6h_24h", "7d_30d", "1y_3y")
    items = [
        _input(
            f"item-{index:03d}",
            _metadata(
                rating=ratings[index % len(ratings)],
                fav=(index * 29) % 701,
                up=(index * 17) % 401,
                down=None if index % 11 == 0 else (index * 7) % 13,
                bucket=buckets[index % len(buckets)],
                pixel_hash=(f"duplicate-{index // 2}" if index in (40, 41) else None),
            ),
            image_hash=("same-content" if index in (120, 121) else f"hash-{index}"),
        )
        for index in range(320)
    ]
    permuted = items[::2][::-1] + items[1::2]

    baseline = {
        output.item_id: output
        for output in score_batch(items, intensity=ScreeningIntensity.BALANCED)
    }
    rerun = {
        output.item_id: output
        for output in score_batch(permuted, intensity=ScreeningIntensity.BALANCED)
    }

    assert rerun == baseline


def test_intensity_changes_candidate_pools_without_changing_scores_or_ranks() -> None:
    items = [
        _input(
            str(index),
            _metadata(fav=50 + index * index, up=50 + index, down=0),
        )
        for index in range(100)
    ]
    by_intensity = {
        intensity: {output.item_id: output for output in score_batch(items, intensity=intensity)}
        for intensity in ScreeningIntensity
    }

    for item_id in by_intensity[ScreeningIntensity.BALANCED]:
        comparable = {
            intensity: (
                outputs[item_id].keep_score,
                outputs[item_id].elite_score,
                outputs[item_id].final_score,
                outputs[item_id].rating_rank,
                outputs[item_id].rating_percentile,
            )
            for intensity, outputs in by_intensity.items()
        }
        assert len(set(comparable.values())) == 1

    pool_assignments = {
        intensity: tuple(outputs[str(index)].candidate_pool for index in range(len(items)))
        for intensity, outputs in by_intensity.items()
    }
    assert len(set(pool_assignments.values())) == len(ScreeningIntensity)


def test_exact_content_duplicates_are_marked_without_changing_scores() -> None:
    first = _input("a", _metadata(fav=30, up=20), image_hash="same")
    second = _input("b", _metadata(fav=2, up=1), image_hash="same")
    unique = _input("c", _metadata(fav=5, up=4), image_hash="unique")
    outputs = {
        item.item_id: item
        for item in score_batch([first, second, unique], intensity=ScreeningIntensity.BALANCED)
    }

    assert outputs["a"].pixel_duplicate_group == "content:same"
    assert outputs["b"].pixel_duplicate_group == "content:same"
    assert sum(outputs[item].duplicate_representative for item in ("a", "b")) == 1
    representative = next(
        outputs[item] for item in ("a", "b") if outputs[item].duplicate_representative
    )
    duplicate = next(
        outputs[item] for item in ("a", "b") if not outputs[item].duplicate_representative
    )
    assert duplicate.duplicate_of_asset_id == representative.asset_id
    assert outputs["c"].pixel_duplicate_group is None
    assert outputs["a"].final_score > outputs["b"].final_score


@pytest.mark.parametrize(
    ("up", "bucket"),
    [
        (0, "0"),
        (2, "2"),
        (3, "3_4"),
        (5, "5_9"),
        (20, "20_49"),
        (500, "gte500"),
    ],
)
def test_up_bucket_boundaries(up: int, bucket: str) -> None:
    assert up_bucket(up) == bucket
