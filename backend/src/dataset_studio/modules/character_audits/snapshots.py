from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path

from dataset_studio.core.errors import AssetNotFoundError, ResourceConflictError
from dataset_studio.core.files import file_sha256
from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.assets.candidates import candidate_scope_clause
from dataset_studio.modules.assets.models import CandidateScope
from dataset_studio.modules.character_audits.models import AssetSnapshot, AuditCreateRequest
from dataset_studio.modules.character_audits.rules import in_directory


def read_assets(connection: sqlite3.Connection, asset_ids: Sequence[str]) -> list[AssetSnapshot]:
    result = []
    for asset_id in asset_ids:
        row = connection.execute(
            """SELECT a.id, a.relative_path, a.content_hash, d.head_revision_id,
                      r.validation_status, r.image_content_hash, r.is_tombstone,
                      (SELECT COUNT(*) FROM annotation_document_revisions c
                       WHERE c.document_id = d.id AND c.is_candidate = 1
                         AND (r.created_at IS NULL OR c.created_at > r.created_at)) AS candidates
               FROM assets a
               LEFT JOIN annotation_documents d ON d.asset_id = a.id AND d.channel = 'tags'
               LEFT JOIN annotation_document_revisions r ON r.id = d.head_revision_id
               WHERE a.id = ? AND a.is_present = 1""",
            (asset_id,),
        ).fetchone()
        if row is None:
            raise AssetNotFoundError(f"角色审查素材已不存在：{asset_id}")
        tags = [
            AnnotationTag(
                name=str(item["name"]),
                category=item["category"],
                confidence=item["confidence"],
                origin=str(item["origin"]),
            )
            for item in connection.execute(
                "SELECT * FROM annotation_tag_items WHERE revision_id = ? ORDER BY position",
                (row["head_revision_id"],),
            )
        ]
        result.append(
            AssetSnapshot(
                asset_id=asset_id,
                relative_path=str(row["relative_path"]),
                image_hash=str(row["content_hash"]),
                revision_id=row["head_revision_id"],
                tags=tags,
                usable=bool(
                    tags
                    and not row["is_tombstone"]
                    and row["validation_status"] in ("valid", "manually_accepted")
                    and row["image_content_hash"] == row["content_hash"]
                ),
                candidate_count=int(row["candidates"]),
            )
        )
    return result


def scope_asset_ids(connection: sqlite3.Connection, request: AuditCreateRequest) -> list[str]:
    if request.scope == "selected":
        return list(dict.fromkeys(request.asset_ids))
    rows = connection.execute(
        "SELECT id, relative_path FROM assets WHERE is_present = 1 AND "
        + candidate_scope_clause(CandidateScope.AUTO)
        + " ORDER BY relative_path"
    ).fetchall()
    return [
        str(row["id"])
        for row in rows
        if request.scope == "all"
        or in_directory(str(row["relative_path"]), request.directory or "")
    ]


def validate_files(root: Path, assets: Sequence[AssetSnapshot]) -> None:
    for asset in assets:
        path = (root / asset.relative_path).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise ResourceConflictError(f"素材不存在或超出项目范围：{asset.relative_path}")
        if file_sha256(path) != asset.image_hash:
            raise ResourceConflictError(
                f"素材内容已变化：{asset.relative_path}，请重新扫描并创建审查。"
            )


def validate_current_inputs(
    connection: sqlite3.Connection,
    root: Path,
    sources: Sequence[AssetSnapshot],
    references: Sequence[AssetSnapshot],
) -> None:
    current = read_assets(connection, [asset.asset_id for asset in sources])
    if current != list(sources):
        raise ResourceConflictError("审查输入的 Tags、候选结果或素材版本已变化，请重新创建审查。")
    current_references = read_assets(connection, [asset.asset_id for asset in references])
    if any(
        (old.image_hash, old.relative_path) != (new.image_hash, new.relative_path)
        for old, new in zip(references, current_references, strict=True)
    ):
        raise ResourceConflictError("参考图版本已变化，请重新创建审查。")
    unique = {item.asset_id: item for item in [*sources, *references]}
    validate_files(root, list(unique.values()))
