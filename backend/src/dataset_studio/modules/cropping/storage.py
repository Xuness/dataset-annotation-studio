from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Literal

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.cropping.models import CropOperation, CropPlanItem, CropProvenance
from dataset_studio.modules.cropping.planner import load_plan, safe_path
from dataset_studio.modules.workspaces.paths import WorkspacePaths


def operation(database: Path, operation_id: str) -> CropOperation:
    with closing(connect(database)) as connection:
        row = connection.execute(
            "SELECT * FROM crop_operations WHERE id=?", (operation_id,)
        ).fetchone()
    if row is None:
        raise ValueError(f"裁剪操作不存在：{operation_id}")
    return CropOperation.model_validate(dict(row))


def start_operation(
    database: Path, operation_id: str, plan_id: str, items: list[CropPlanItem]
) -> None:
    with transaction(database) as connection:
        if connection.execute(
            "SELECT 1 FROM crop_operations WHERE plan_id=?", (plan_id,)
        ).fetchone():
            raise ValueError("此裁剪预览已执行，不能重复提交；请重新预览。")
        now = utc_now_iso()
        connection.execute(
            "INSERT INTO crop_operations VALUES (?, ?, 'running', ?, 0, NULL, ?)",
            (operation_id, plan_id, len(items), now),
        )
        connection.execute(
            """INSERT INTO preprocess_operations
            (id,status,options_json,item_count,created_at) VALUES (?, 'running', ?, ?, ?)""",
            (operation_id, '{"convert":{"format":"png"}}', len(items), now),
        )
        for item in items:
            connection.execute(
                "INSERT INTO crop_outputs VALUES (?, ?, ?, ?, ?, ?, '', 'prepared')",
                (
                    item.output_id,
                    operation_id,
                    item.source_id,
                    item.source_hash,
                    item.output_path,
                    item.rectangle.model_dump_json(),
                ),
            )


def register_output(
    connection: sqlite3.Connection, paths: WorkspacePaths, item: CropPlanItem, output_hash: str
) -> None:
    output = safe_path(paths.root, item.output_path)
    stat = output.stat()
    now = utc_now_iso()
    connection.execute(
        """INSERT INTO assets
        (id,relative_path,filename,stem,suffix,content_hash,byte_size,modified_ns,width,height,
         annotation_relative_path,annotation_status,annotation_modified_ns,metadata_relative_path,
         is_present,created_at,updated_at,image_metadata_version)
        VALUES (?, ?, ?, ?, '.png', ?, ?, ?, ?, ?, ?, 'missing', NULL, NULL, 1, ?, ?, 2)""",
        (
            item.output_id,
            item.output_path,
            output.name,
            output.stem,
            output_hash,
            stat.st_size,
            stat.st_mtime_ns,
            item.rectangle.width,
            item.rectangle.height,
            output.with_suffix(".txt").relative_to(paths.root).as_posix(),
            now,
            now,
        ),
    )
    connection.execute("UPDATE crop_outputs SET phase='committed' WHERE id=?", (item.output_id,))


def finish(
    database: Path,
    operation_id: str,
    status: Literal["succeeded", "undone", "failed", "recovery_failed", "undoing"],
    error: str | None,
) -> None:
    with transaction(database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status=?,error=?, "
            "completed=CASE WHEN ?='failed' THEN 0 ELSE completed END WHERE id=?",
            (status, error, status, operation_id),
        )
        preprocess_status = {
            "succeeded": "completed",
            "undone": "undone",
            "failed": "failed",
            "recovery_failed": "recovering",
            "undoing": "recovering",
        }[status]
        connection.execute(
            "UPDATE preprocess_operations SET status=?,error_message=?,completed_at=? WHERE id=?",
            (preprocess_status, error, utc_now_iso(), operation_id),
        )


def output_rows(database: Path, operation_id: str) -> list[sqlite3.Row]:
    with closing(connect(database)) as connection:
        return connection.execute(
            "SELECT * FROM crop_outputs WHERE operation_id=? ORDER BY rowid", (operation_id,)
        ).fetchall()


def check_output(paths: WorkspacePaths, row: sqlite3.Row) -> None:
    output = safe_path(paths.root, str(row["relative_path"]))
    if not output.is_file() or file_sha256(output) != str(row["output_hash"]):
        raise ValueError(f"裁剪结果已修改、移动或缺失，拒绝删除：{row['relative_path']}")
    if (
        any(output.parent.glob(f"{output.stem}.*.txt"))
        or output.with_suffix(".txt").exists()
        or output.with_suffix(".json").exists()
    ):
        raise ValueError(f"裁剪结果已有旁车数据，拒绝删除：{row['relative_path']}")
    with closing(connect(paths.database)) as connection:
        asset = connection.execute(
            "SELECT relative_path,content_hash FROM assets WHERE id=?", (row["id"],)
        ).fetchone()
        if asset is not None and (
            asset["relative_path"] != row["relative_path"]
            or asset["content_hash"] != row["output_hash"]
        ):
            raise ValueError(f"裁剪素材索引已变化，拒绝删除：{row['relative_path']}")
        checks = (
            ("SELECT 1 FROM annotation_documents WHERE asset_id=?", "标注或复核记录"),
            ("SELECT 1 FROM job_items WHERE asset_id=?", "后续任务记录"),
            (
                "SELECT 1 FROM crop_outputs c JOIN crop_operations o ON o.id=c.operation_id "
                "WHERE c.source_id=? AND o.status NOT IN ('failed','undone')",
                "派生裁剪依赖",
            ),
        )
        for sql, reason in checks:
            if connection.execute(sql, (row["id"],)).fetchone():
                raise ValueError(f"裁剪结果存在{reason}，拒绝删除：{row['relative_path']}")


def provenance(database: Path, output_id: str) -> CropProvenance | None:
    with closing(connect(database)) as connection:
        row = connection.execute(
            "SELECT o.id,o.plan_id FROM crop_outputs c "
            "JOIN crop_operations o ON o.id=c.operation_id WHERE c.id=?",
            (output_id,),
        ).fetchone()
    if row is None:
        return None
    _, items, _ = load_plan(database, str(row["plan_id"]))
    item = next((item for item in items if item.output_id == output_id), None)
    if item is None:
        raise ValueError(f"裁剪来源记录损坏：output={output_id}，plan={row['plan_id']}")
    return CropProvenance(operation_id=str(row["id"]), item=item)
