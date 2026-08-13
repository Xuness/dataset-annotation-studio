from __future__ import annotations

import hashlib
import json
import stat
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MAX_METADATA_BYTES = 8 * 1024 * 1024
RATING_ALIASES = {
    "g": "g",
    "general": "g",
    "s": "s",
    "sensitive": "s",
    "q": "q",
    "questionable": "q",
    "e": "e",
    "explicit": "e",
}


class MetadataReadError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class NormalizedMetadata:
    rating: str
    created_at: str
    metadata_snapshot_at: str
    age_hours: float
    age_bucket: str
    fav_count: int
    up_score: int
    downvote_count: int | None
    evidence_mass: int
    vote_evidence: int | None
    disposition: str
    post_id: str | None
    parent_id: str | None
    has_children: bool
    pixel_hash: str | None
    warnings: tuple[str, ...]
    task_tags: tuple[str, ...] | None = None

    def snapshot(self) -> dict[str, object]:
        return {
            "rating": self.rating,
            "created_at": self.created_at,
            "metadata_snapshot_at": self.metadata_snapshot_at,
            "age_hours": self.age_hours,
            "age_bucket": self.age_bucket,
            "fav_count": self.fav_count,
            "up_score": self.up_score,
            "downvote_count": self.downvote_count,
            "evidence_mass": self.evidence_mass,
            "vote_evidence": self.vote_evidence,
            "disposition": self.disposition,
            "post_id": self.post_id,
            "parent_id": self.parent_id,
            "has_children": self.has_children,
            "pixel_hash": self.pixel_hash,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class MetadataReadResult:
    metadata: NormalizedMetadata
    content_hash: str
    byte_size: int
    modified_ns: int


def read_metadata(
    root: Path,
    relative_path: str | None,
    *,
    fallback_snapshot_at: str | None,
    expected_size: int | None,
    expected_modified_ns: int | None,
) -> MetadataReadResult:
    if not relative_path:
        raise MetadataReadError("METADATA_MISSING", "图片没有同名 Danbooru JSON 元数据。")
    try:
        resolved_root = root.resolve()
        unresolved_path = resolved_root / relative_path
        path = unresolved_path.resolve()
    except OSError as error:
        raise MetadataReadError(
            "METADATA_READ_ERROR", f"无法解析元数据 JSON 路径：{error}"
        ) from error
    if not path.is_relative_to(resolved_root):
        raise MetadataReadError("METADATA_PATH_ESCAPE", "元数据路径超出当前工作区。")
    try:
        if unresolved_path.is_symlink():
            raise MetadataReadError("METADATA_SYMLINK", "同名 Danbooru JSON 不能是符号链接。")
    except OSError as error:
        raise MetadataReadError(
            "METADATA_READ_ERROR", f"无法检查元数据 JSON 路径：{error}"
        ) from error
    try:
        before = path.stat()
    except FileNotFoundError as error:
        raise MetadataReadError("METADATA_MISSING", "同名 Danbooru JSON 已不存在。") from error
    except OSError as error:
        raise MetadataReadError(
            "METADATA_READ_ERROR", f"无法读取元数据 JSON 状态：{error}"
        ) from error
    if not stat.S_ISREG(before.st_mode):
        raise MetadataReadError("METADATA_MISSING", "同名 Danbooru JSON 已不存在。")
    if before.st_size > MAX_METADATA_BYTES:
        raise MetadataReadError("METADATA_TOO_LARGE", "元数据 JSON 超过 8 MiB 安全读取上限。")
    if expected_size is not None and before.st_size != expected_size:
        raise MetadataReadError("METADATA_CHANGED", "元数据 JSON 在筛选任务创建后发生了变化。")
    if expected_modified_ns is not None and before.st_mtime_ns != expected_modified_ns:
        raise MetadataReadError("METADATA_CHANGED", "元数据 JSON 在筛选任务创建后发生了变化。")
    try:
        payload = path.read_bytes()
    except OSError as error:
        raise MetadataReadError("METADATA_READ_ERROR", f"无法读取元数据 JSON：{error}") from error
    try:
        after = path.stat()
    except OSError as error:
        raise MetadataReadError(
            "METADATA_CHANGED", "元数据 JSON 在读取过程中被移除或替换。"
        ) from error
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise MetadataReadError("METADATA_CHANGED", "元数据 JSON 在读取过程中发生了变化。")
    try:
        value = json.loads(payload.decode("utf-8-sig"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise MetadataReadError(
            "METADATA_INVALID_JSON", f"元数据 JSON 无法解析：{error}"
        ) from error
    if not isinstance(value, dict):
        raise MetadataReadError("METADATA_INVALID_ROOT", "元数据 JSON 顶层必须是对象。")
    return MetadataReadResult(
        metadata=normalize_metadata(
            value,
            fallback_snapshot_at=fallback_snapshot_at,
            file_snapshot_at=_iso(datetime.fromtimestamp(before.st_mtime, tz=UTC)),
        ),
        content_hash=hashlib.sha256(payload).hexdigest(),
        byte_size=before.st_size,
        modified_ns=before.st_mtime_ns,
    )


def normalize_metadata(
    value: dict[str, Any],
    *,
    fallback_snapshot_at: str | None,
    file_snapshot_at: str | None = None,
) -> NormalizedMetadata:
    sources = _candidate_sources(value)
    rating_raw = _find(sources, "rating")
    if rating_raw is None:
        raise MetadataReadError("RATING_MISSING", "元数据缺少 rating，无法参与 Rating 内排名。")
    rating = RATING_ALIASES.get(str(rating_raw).strip().casefold())
    if rating is None:
        raise MetadataReadError("RATING_INVALID", f"无法识别 Danbooru rating：{rating_raw}")

    created_raw = _find(sources, "created_at", "post_created_at")
    if created_raw is None:
        raise MetadataReadError("CREATED_AT_MISSING", "元数据缺少 created_at。")
    created = _parse_datetime(created_raw, "created_at")

    snapshot_raw = _find(
        sources,
        "metadata_snapshot_at",
        "snapshot_at",
        "observed_at",
        "fetched_at",
    )
    snapshot_source = "json"
    if snapshot_raw is None:
        # Complement exports persist the acquisition plan timestamp even when
        # they do not expose a canonical metadata_snapshot_at.  It is the
        # stable observation-time proxy used by the source pipeline and is
        # preferable to a later copy/export mtime.
        snapshot_raw = _find(sources, "pipeline_plan_created_at")
        if snapshot_raw is not None:
            snapshot_source = "pipeline_plan"
    if snapshot_raw is None and fallback_snapshot_at is not None:
        snapshot_raw = fallback_snapshot_at
        snapshot_source = "operation"
    elif snapshot_raw is None and file_snapshot_at is not None:
        snapshot_raw = file_snapshot_at
        snapshot_source = "file_mtime"
    if snapshot_raw is None:
        raise MetadataReadError(
            "SNAPSHOT_AT_MISSING",
            "元数据缺少快照时间；请为本次任务指定 metadata_snapshot_at 回退值。",
        )
    snapshot = _parse_datetime(snapshot_raw, "metadata_snapshot_at")
    age_hours = (snapshot - created).total_seconds() / 3600
    if age_hours < 0:
        raise MetadataReadError("SNAPSHOT_BEFORE_CREATED", "元数据快照时间早于图片发布时间。")

    fav = _required_count(sources, "fav_count")
    up = _required_count(sources, "up_score")
    warnings: list[str] = []
    raw_down = _find(sources, "down_score")
    raw_downvote = _find(sources, "downvote_count")
    if raw_down is None and raw_downvote is None:
        downvote_count = None
        vote_evidence = None
        warnings.append("DOWN_SCORE_MISSING_VOTE_NEUTRAL")
    elif raw_downvote is not None:
        downvote_count = max(0, _integer(raw_downvote, "downvote_count"))
        if raw_down is not None:
            signed_down = _integer(raw_down, "down_score")
            normalized_signed_down = max(0, -signed_down)
            if normalized_signed_down != downvote_count:
                raise MetadataReadError(
                    "DOWN_SCORE_CONFLICT",
                    "down_score 与 downvote_count 表示的踩票数不一致。",
                )
            if signed_down > 0:
                warnings.append("POSITIVE_DOWN_SCORE_NORMALIZED")
        vote_evidence = up + downvote_count
    else:
        signed_down = _integer(raw_down, "down_score")
        downvote_count = max(0, -signed_down)
        if signed_down > 0:
            warnings.append("POSITIVE_DOWN_SCORE_NORMALIZED")
        vote_evidence = up + downvote_count

    # Missing vote data must stay unavailable instead of being treated as zero
    # downvotes.  Popularity confidence can still use the known F + U lower
    # bound, while a present signed down_score contributes the full F + U + D.
    evidence_mass = fav + up + downvote_count if downvote_count is not None else fav + up
    disposition = _disposition(sources)
    post_id = _optional_identifier(_find(sources, "id", "post_id"))
    parent_id = _optional_identifier(_find(sources, "parent_id"))
    has_children = _bool(_find(sources, "has_children"), default=False)
    pixel_hash = _optional_identifier(_find(sources, "media_asset_pixel_hash", "pixel_hash"))
    task_tags = _task_tags(sources)
    if task_tags is None:
        warnings.append("TASK_TAGS_UNAVAILABLE")
    if snapshot_source == "pipeline_plan":
        warnings.append("SNAPSHOT_FROM_PIPELINE_PLAN_PROXY")
    elif snapshot_source == "operation":
        warnings.append("SNAPSHOT_FROM_OPERATION_FALLBACK")
    elif snapshot_source == "file_mtime":
        warnings.append("SNAPSHOT_FROM_SIDECAR_MTIME")

    return NormalizedMetadata(
        rating=rating,
        created_at=_iso(created),
        metadata_snapshot_at=_iso(snapshot),
        age_hours=age_hours,
        age_bucket=age_bucket(age_hours),
        fav_count=fav,
        up_score=up,
        downvote_count=downvote_count,
        evidence_mass=evidence_mass,
        vote_evidence=vote_evidence,
        disposition=disposition,
        post_id=post_id,
        parent_id=parent_id,
        has_children=has_children,
        pixel_hash=pixel_hash,
        warnings=tuple(warnings),
        task_tags=task_tags,
    )


def age_bucket(age_hours: float) -> str:
    day = 24.0
    year = 365 * day
    boundaries = (
        (6, "lt6h"),
        (day, "6h_24h"),
        (3 * day, "1d_3d"),
        (7 * day, "3d_7d"),
        (30 * day, "7d_30d"),
        (90 * day, "30d_90d"),
        (year, "90d_1y"),
        (3 * year, "1y_3y"),
        (10 * year, "3y_10y"),
    )
    for upper, name in boundaries:
        if age_hours < upper:
            return name
    return "gte10y"


def _candidate_sources(value: dict[str, Any]) -> list[dict[str, Any]]:
    sources = [value]
    for key in ("metadata", "danbooru", "post", "data", "media_asset"):
        nested = value.get(key)
        if isinstance(nested, dict):
            sources.append(nested)
    return sources


def _find(sources: list[dict[str, Any]], *names: str) -> Any:
    for source in sources:
        for name in names:
            if name in source and source[name] is not None:
                return source[name]
    return None


def _task_tags(sources: list[dict[str, Any]]) -> tuple[str, ...] | None:
    general = _find(sources, "tag_string_general")
    meta = _find(sources, "tag_string_meta")
    raw_values = [value for value in (general, meta) if value is not None]
    if not raw_values:
        fallback = _find(sources, "tag_string", "tags")
        if fallback is None:
            return None
        raw_values = [fallback]

    tags: set[str] = set()
    for raw in raw_values:
        if isinstance(raw, str):
            candidates = raw.split()
        elif isinstance(raw, (list, tuple, set)):
            candidates = [str(value) for value in raw]
        else:
            return None
        tags.update(tag.strip().casefold() for tag in candidates if tag.strip())
    return tuple(sorted(tags))


def _integer(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise MetadataReadError("FIELD_INVALID", f"{field} 不是有效整数。")
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise MetadataReadError("FIELD_INVALID", f"{field} 不是有效整数。") from error
    if isinstance(value, float) and not value.is_integer():
        raise MetadataReadError("FIELD_INVALID", f"{field} 不是有效整数。")
    return number


def _required_count(sources: list[dict[str, Any]], field: str) -> int:
    value = _find(sources, field)
    if value is None:
        raise MetadataReadError(field.upper() + "_MISSING", f"元数据缺少 {field}。")
    return max(0, _integer(value, field))


def _parse_datetime(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as error:
            raise MetadataReadError("DATETIME_INVALID", f"{field} 不是有效 ISO 时间。") from error
    else:
        raise MetadataReadError("DATETIME_INVALID", f"{field} 不是有效 ISO 时间。")
    if parsed.tzinfo is None:
        raise MetadataReadError("DATETIME_TIMEZONE_MISSING", f"{field} 必须包含时区。")
    return parsed.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return default


def _disposition(sources: list[dict[str, Any]]) -> str:
    if any(_bool(_find(sources, field), default=False) for field in ("is_deleted", "is_banned")):
        return "invalid"
    active = _find(sources, "is_active")
    public = _find(sources, "is_public")
    if (active is not None and not _bool(active, default=True)) or (
        public is not None and not _bool(public, default=True)
    ):
        return "invalid"
    download_status = _find(sources, "download_status")
    if download_status is not None and str(download_status).casefold() not in {
        "ok",
        "success",
        "downloaded",
        "200",
    }:
        return "invalid"
    status = _find(sources, "status")
    if status is not None and str(status).casefold() in {
        "deleted",
        "banned",
        "inactive",
        "non-public",
        "non_public",
        "failed",
    }:
        return "invalid"
    if any(_bool(_find(sources, field), default=False) for field in ("is_pending", "is_flagged")):
        return "quarantine"
    return "valid"


def _optional_identifier(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None
