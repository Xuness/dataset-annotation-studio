from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.translations.languages import LANGUAGE_PATTERN

_RESOURCE_PREFIX = "workspace-file:"
LOGGER = logging.getLogger("dataset_studio.output_resources")


@dataclass(frozen=True, slots=True)
class OutputResourceClaim:
    resource_key: str
    job_item_id: str | None = None


def annotation_output_resource_key(annotation_relative_path: str) -> str:
    return _RESOURCE_PREFIX + _normalized_relative_path(annotation_relative_path)


def translation_output_relative_path(
    annotation_relative_path: str,
    language: str,
) -> str:
    annotation_path = _relative_path(annotation_relative_path)
    if not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError("翻译任务的目标语言快照无效。")
    return annotation_path.with_name(f"{annotation_path.stem}.{language}.txt").as_posix()


@contextmanager
def hold_output_resources(
    database_path: Path,
    claims: Sequence[OutputResourceClaim],
) -> Iterator[None]:
    """Hold foreground leases or verify leases already owned by job items."""

    if not claims:
        yield
        return
    resource_keys = [claim.resource_key for claim in claims]
    if len(resource_keys) != len(set(resource_keys)):
        raise ValueError("同一写入操作包含重复的输出资源。")

    operation_id = str(uuid.uuid4())
    has_foreground_claims = False
    with transaction(database_path) as connection:
        for claim in sorted(claims, key=lambda item: item.resource_key):
            if claim.job_item_id is not None:
                lease = connection.execute(
                    """
                    SELECT job_item_id
                    FROM output_resource_leases
                    WHERE resource_key = ?
                    """,
                    (claim.resource_key,),
                ).fetchone()
                if lease is None or str(lease["job_item_id"]) != claim.job_item_id:
                    raise ResourceConflictError("后台任务的输出资源租约已失效，结果未写入。")
                continue
            acquired = connection.execute(
                """
                INSERT OR IGNORE INTO output_resource_leases (
                    resource_key, operation_id, acquired_at
                ) VALUES (?, ?, ?)
                """,
                (claim.resource_key, operation_id, utc_now_iso()),
            ).rowcount
            if not acquired:
                raise ResourceConflictError(
                    "目标文件正由另一个后台任务或编辑操作写入，请稍后重试。"
                )
            has_foreground_claims = True
    try:
        yield
    finally:
        if has_foreground_claims:
            try:
                with transaction(database_path) as connection:
                    connection.execute(
                        "DELETE FROM output_resource_leases WHERE operation_id = ?",
                        (operation_id,),
                    )
            except Exception:
                LOGGER.exception(
                    "Output operation %s finished, but its resource lease could not be released.",
                    operation_id,
                )


def _normalized_relative_path(value: str) -> str:
    return _relative_path(value).as_posix().casefold()


def _relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if (
        not value
        or path.is_absolute()
        or "\\" in value
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError("任务输出路径必须位于当前工作区内。")
    return path
