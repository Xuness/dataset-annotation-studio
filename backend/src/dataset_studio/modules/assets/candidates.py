from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.assets.models import (
    CandidateScope,
    CandidateSetSummary,
    CandidateSourceKind,
    CandidateUpdateAction,
    CandidateUpdateRequest,
)


def candidate_scope_clause(scope: CandidateScope | str, *, asset_alias: str = "assets") -> str:
    """Return a SQL predicate for the persisted candidate workspace scope."""

    normalized_scope = CandidateScope(scope)
    if not asset_alias.replace("_", "").isalnum():
        raise ValueError("候选范围 SQL 使用了无效的素材表别名。")
    if normalized_scope == CandidateScope.ALL:
        return "1 = 1"

    membership = (
        "EXISTS (SELECT 1 FROM asset_candidates candidate_membership "
        f"WHERE candidate_membership.asset_id = {asset_alias}.id)"
    )
    if normalized_scope == CandidateScope.CANDIDATES:
        return membership

    any_present_candidate = """
    EXISTS (
        SELECT 1
        FROM asset_candidates active_candidate
        JOIN assets active_candidate_asset ON active_candidate_asset.id = active_candidate.asset_id
        WHERE active_candidate_asset.is_present = 1
    )
    """
    return f"(NOT ({any_present_candidate}) OR {membership})"


def ensure_assets_in_effective_scope(database_path: Path, asset_ids: Sequence[str]) -> None:
    """Reject explicit downstream work that escapes an active candidate set."""

    unique_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
    if not unique_ids:
        return
    connection = connect(database_path)
    try:
        active = bool(
            connection.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM asset_candidates c
                    JOIN assets a ON a.id = c.asset_id
                    WHERE a.is_present = 1
                )
                """
            ).fetchone()[0]
        )
        if not active:
            return
        allowed: set[str] = set()
        for start in range(0, len(unique_ids), 500):
            batch = unique_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = connection.execute(
                f"""
                SELECT c.asset_id
                FROM asset_candidates c
                JOIN assets a ON a.id = c.asset_id
                WHERE a.is_present = 1 AND c.asset_id IN ({placeholders})
                """,
                batch,
            ).fetchall()
            allowed.update(str(row["asset_id"]) for row in rows)
    finally:
        connection.close()

    outside_count = len(set(unique_ids) - allowed)
    if outside_count:
        raise ValueError(f"候选集已经启用；当前选择中有 {outside_count} 张图片不在候选集内。")


class CandidateRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def summary(self) -> CandidateSetSummary:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT
                    COUNT(*) AS total_assets,
                    SUM(
                        CASE WHEN EXISTS (
                            SELECT 1 FROM asset_candidates c WHERE c.asset_id = assets.id
                        ) THEN 1 ELSE 0 END
                    ) AS candidate_count
                FROM assets
                WHERE is_present = 1
                """
            ).fetchone()
        finally:
            connection.close()
        total_assets = int(row["total_assets"] or 0)
        candidate_count = int(row["candidate_count"] or 0)
        return CandidateSetSummary(
            total_assets=total_assets,
            candidate_count=candidate_count,
            effective_count=candidate_count or total_assets,
            active=candidate_count > 0,
        )

    def list_ids(self) -> list[str]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT a.id
                FROM asset_candidates c
                JOIN assets a ON a.id = c.asset_id
                WHERE a.is_present = 1
                ORDER BY a.relative_path COLLATE NOCASE
                """
            ).fetchall()
            return [str(row["id"]) for row in rows]
        finally:
            connection.close()

    def update(self, request: CandidateUpdateRequest) -> CandidateSetSummary:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            if request.action in {CandidateUpdateAction.ADD, CandidateUpdateAction.REPLACE}:
                self._validate_present_assets(connection, request.asset_ids)
                if request.source_kind == CandidateSourceKind.SCREENING:
                    self._validate_screening_source(
                        connection,
                        request.source_operation_id or "",
                        request.asset_ids,
                    )

            if request.action in {CandidateUpdateAction.REPLACE, CandidateUpdateAction.CLEAR}:
                connection.execute("DELETE FROM asset_candidates")

            if request.action in {CandidateUpdateAction.ADD, CandidateUpdateAction.REPLACE}:
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO asset_candidates (
                        asset_id, added_at, source_kind, source_operation_id
                    ) VALUES (?, ?, ?, ?)
                    """,
                    [
                        (
                            asset_id,
                            now,
                            request.source_kind.value,
                            request.source_operation_id,
                        )
                        for asset_id in request.asset_ids
                    ],
                )
            elif request.action == CandidateUpdateAction.REMOVE:
                for start in range(0, len(request.asset_ids), 500):
                    batch = request.asset_ids[start : start + 500]
                    placeholders = ",".join("?" for _ in batch)
                    connection.execute(
                        f"DELETE FROM asset_candidates WHERE asset_id IN ({placeholders})",
                        batch,
                    )
        return self.summary()

    @staticmethod
    def _validate_present_assets(connection, asset_ids: Sequence[str]) -> None:
        found: set[str] = set()
        for start in range(0, len(asset_ids), 500):
            batch = asset_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = connection.execute(
                f"SELECT id FROM assets WHERE is_present = 1 AND id IN ({placeholders})",
                batch,
            ).fetchall()
            found.update(str(row["id"]) for row in rows)
        missing_count = len(set(asset_ids) - found)
        if missing_count:
            raise ValueError(f"候选图片中有 {missing_count} 项已经不存在，请重新选择。")

    @staticmethod
    def _validate_screening_source(
        connection,
        operation_id: str,
        asset_ids: Sequence[str],
    ) -> None:
        operation = connection.execute(
            "SELECT id FROM screening_operations WHERE id = ?",
            (operation_id,),
        ).fetchone()
        if operation is None:
            raise ValueError("关联的筛选任务不存在。")
        found: set[str] = set()
        for start in range(0, len(asset_ids), 500):
            batch = asset_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = connection.execute(
                f"""
                SELECT asset_id
                FROM screening_items
                WHERE operation_id = ? AND asset_id IN ({placeholders})
                """,
                [operation_id, *batch],
            ).fetchall()
            found.update(str(row["asset_id"]) for row in rows)
        outside_count = len(set(asset_ids) - found)
        if outside_count:
            raise ValueError(f"候选图片中有 {outside_count} 项不属于指定的筛选任务。")
