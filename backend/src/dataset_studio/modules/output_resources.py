from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import transaction
from dataset_studio.core.time import utc_now_iso

_ANNOTATION_DOCUMENT_PREFIX = "annotation-document:"
LOGGER = logging.getLogger("dataset_studio.output_resources")
_OWNER_INSTANCE_ID = str(uuid.uuid4())
_OWNER_ROLE = "embedded"


@dataclass(frozen=True, slots=True)
class OutputResourceClaim:
    resource_key: str
    job_item_id: str | None = None


def configure_output_resource_owner(role: str) -> None:
    normalized = role.strip().lower()
    if not normalized or any(character in normalized for character in ("\x00", "\n", "\r")):
        raise ValueError("输出资源所有者角色无效。")
    global _OWNER_ROLE
    _OWNER_ROLE = normalized


def recover_stale_operation_leases(database_path: Path) -> int:
    with transaction(database_path) as connection:
        return connection.execute(
            """
            DELETE FROM output_resource_leases
            WHERE operation_id IS NOT NULL
              AND (
                  owner_role IS NULL
                  OR owner_role = 'legacy'
                  OR (
                      owner_role = ?
                      AND owner_instance_id != ?
                  )
              )
            """,
            (_OWNER_ROLE, _OWNER_INSTANCE_ID),
        ).rowcount


def annotation_document_resource_key(
    asset_id: str,
    channel: str,
    language: str = "",
) -> str:
    if not asset_id or not channel:
        raise ValueError("标注资源缺少素材或通道标识。")
    if any(character in asset_id for character in ("\x00", "\n", "\r")):
        raise ValueError("素材标识包含无效字符。")
    if any(character in channel for character in ("\x00", "\n", "\r", ":")):
        raise ValueError("标注通道包含无效字符。")
    if any(character in language for character in ("\x00", "\n", "\r", ":")):
        raise ValueError("标注语言包含无效字符。")
    return f"{_ANNOTATION_DOCUMENT_PREFIX}{asset_id}:{channel}:{language}"


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
                    resource_key, operation_id, acquired_at,
                    owner_role, owner_instance_id
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    claim.resource_key,
                    operation_id,
                    utc_now_iso(),
                    _OWNER_ROLE,
                    _OWNER_INSTANCE_ID,
                ),
            ).rowcount
            if not acquired:
                raise ResourceConflictError(
                    "目标标注通道正由另一个后台任务或编辑操作写入，请稍后重试。"
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
