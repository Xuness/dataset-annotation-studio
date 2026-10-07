from __future__ import annotations

import logging
import uuid
from contextlib import ExitStack, closing
from typing import TYPE_CHECKING

from dataset_studio.core.file_targets import hold_file_targets
from dataset_studio.core.files import atomic_copy_file, file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping.errors import CropExecutionError
from dataset_studio.modules.cropping.files import (
    cleanup_staging,
    owns_file,
    publish_copy,
    remember_identity,
)
from dataset_studio.modules.cropping.images import render_png
from dataset_studio.modules.cropping.models import CropExecutionRequest, CropOperation
from dataset_studio.modules.cropping.planner import safe_path, validate_plan
from dataset_studio.modules.cropping.storage import (
    check_output,
    finish,
    operation,
    output_rows,
    register_output,
    start_operation,
)
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.service import WorkspaceService

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from dataset_studio.api.container import AppContainer


def ensure_idle(container: AppContainer, project: str) -> None:
    container.preprocessing.ensure_persisted_inactive(project)
    container.jobs.ensure_inactive(project)
    container.exports.ensure_inactive(project)
    container.asset_deletions.ensure_persisted_inactive(project)
    container.screening.ensure_inactive(project)


def rollback_outputs(paths: WorkspacePaths, operation_id: str) -> None:
    errors: list[str] = []
    for row in reversed(output_rows(paths.database, operation_id)):
        if str(row["phase"]) == "rolled_back":
            cleanup_staging(paths, row)
            continue
        output = safe_path(paths.root, str(row["relative_path"]))
        try:
            if str(row["phase"]) == "committed" and not output.exists():
                raise ValueError(
                    f"已发布的裁剪结果被移动或删除，无法自动回滚：{row['relative_path']}"
                )
            # Identity is journaled before publication, including incomplete SQL commits.
            if output.exists():
                if not owns_file(output, row):
                    if str(row["phase"]) == "prepared":
                        continue
                    raise ValueError(
                        f"裁剪恢复发现非本次拥有的文件，拒绝删除：{row['relative_path']}"
                    )
                check_output(paths, row)
                with transaction(paths.database) as connection:
                    connection.execute(
                        "UPDATE crop_outputs SET phase='rolling_back' WHERE id=?", (row["id"],)
                    )
                output.unlink()
            with transaction(paths.database) as connection:
                connection.execute("DELETE FROM assets WHERE id=?", (row["id"],))
                connection.execute(
                    "UPDATE crop_outputs SET phase='rolled_back' WHERE id=?", (row["id"],)
                )
        except (OSError, ValueError, RuntimeError) as error:
            errors.append(f"{row['relative_path']}：{error}")
        finally:
            cleanup_staging(paths, row)
    if errors:
        raise RuntimeError("裁剪回滚未完成：" + "；".join(errors))


def execute(container: AppContainer, project: str, payload: CropExecutionRequest) -> CropOperation:
    paths, _ = container.workspaces.get(project)
    operation_id = str(uuid.uuid4())
    with (
        container.preprocessing.guard_image_operation(project, operation_id),
        ExitStack() as locks,
    ):
        ensure_idle(container, project)
        items = validate_plan(container, project, payload.plan_id, payload.token)
        locks.enter_context(
            hold_file_targets(
                container.settings.app_data_dir,
                [
                    target
                    for item in items
                    for target in (
                        paths.root / item.source_path,
                        paths.root / item.output_path,
                        (paths.root / item.output_path).with_suffix(".txt"),
                        (paths.root / item.output_path).with_suffix(".json"),
                    )
                ],
            )
        )
        start_operation(paths.database, operation_id, payload.plan_id, items)
        staging = paths.recovery / operation_id / "crop-staging"
        try:
            staging.mkdir(parents=True, exist_ok=False)
            for index, item in enumerate(items):
                source = safe_path(paths.root, item.source_path)
                output = safe_path(paths.root, item.output_path)
                prepared = staging / f"{item.output_id}.png"
                prepared.write_bytes(render_png(source, item.rectangle, None))
                if file_sha256(source) != item.source_hash:
                    raise ValueError(f"裁剪准备过程中源图发生变化：{item.source_path}")
                output_hash = file_sha256(prepared)
                with transaction(paths.database) as connection:
                    connection.execute(
                        "UPDATE crop_outputs SET output_hash=? WHERE id=?",
                        (output_hash, item.output_id),
                    )
                output.parent.mkdir(parents=True, exist_ok=True)
                output = safe_path(paths.root, item.output_path)
                if output.with_suffix(".txt").exists() or output.with_suffix(".json").exists():
                    raise ValueError(f"目标旁车文件在执行前出现，拒绝发布：{item.output_path}")
                publish_copy(paths, item.output_id, item.output_path, prepared, output_hash)
                with transaction(paths.database) as connection:
                    register_output(connection, paths, item, output_hash)
                    connection.execute(
                        "UPDATE crop_operations SET completed=? WHERE id=?",
                        (index + 1, operation_id),
                    )
            finish(paths.database, operation_id, "succeeded", None)
        except Exception as error:
            try:
                rollback_outputs(paths, operation_id)
            except Exception as rollback_error:
                finish(
                    paths.database,
                    operation_id,
                    "recovery_failed",
                    f"执行失败：{error}；回滚失败：{rollback_error}",
                )
                raise CropExecutionError(
                    f"裁剪失败且回滚未完成：operation={operation_id}；{error}；{rollback_error}"
                ) from error
            finish(paths.database, operation_id, "failed", str(error))
            raise CropExecutionError(
                f"裁剪执行失败，已回滚新增结果：operation={operation_id}，"
                f"原因={type(error).__name__}: {error}。请修正后重新预览。"
            ) from error
        return operation(paths.database, operation_id)


def undo(container: AppContainer, project: str, operation_id: str) -> CropOperation:
    paths, _ = container.workspaces.get(project)
    with (
        container.preprocessing.guard_image_operation(project, f"crop-undo:{operation_id}"),
        ExitStack() as locks,
    ):
        ensure_idle(container, project)
        current = operation(paths.database, operation_id)
        if current.status != "succeeded":
            raise ValueError(f"只能撤销成功且未撤销的裁剪操作：status={current.status}")
        with closing(connect(paths.database)) as connection:
            latest = connection.execute(
                "SELECT id FROM preprocess_operations WHERE status='completed' "
                "ORDER BY created_at DESC,rowid DESC LIMIT 1"
            ).fetchone()
        if latest is None or str(latest[0]) != operation_id:
            raise ValueError("只能撤销最新图片操作；请先撤销其后的裁剪或预处理。")
        rows = output_rows(paths.database, operation_id)
        locks.enter_context(
            hold_file_targets(
                container.settings.app_data_dir,
                [paths.root / str(row["relative_path"]) for row in rows],
            )
        )
        for row in rows:
            check_output(paths, row)
            # A later preprocessing operation may have restored identical bytes to a new inode.
            output = safe_path(paths.root, str(row["relative_path"]))
            remember_identity(paths.database, str(row["id"]), output.stat())
        rows = output_rows(paths.database, operation_id)
        backup = paths.recovery / operation_id / "crop-undo"
        backup.mkdir(parents=True, exist_ok=True)
        if any(backup.iterdir()):
            raise ValueError("裁剪撤销恢复目录非空，请先完成中断恢复。")
        with transaction(paths.database) as connection:
            connection.execute(
                "UPDATE crop_operations SET status='undoing' WHERE id=?", (operation_id,)
            )
            connection.execute(
                "UPDATE preprocess_operations SET status='recovering' WHERE id=?", (operation_id,)
            )
        try:
            for row in rows:
                relative = str(row["relative_path"])
                filename = f"{row['id']}.png"
                output = safe_path(paths.root, relative)
                atomic_copy_file(output, backup / filename)
                if file_sha256(backup / filename) != str(row["output_hash"]):
                    raise ValueError(f"裁剪结果在撤销检查后发生变化：{relative}")
                if not owns_file(output, row):
                    raise ValueError(f"裁剪结果在撤销期间被替换：{relative}")
                check_output(paths, row)
                output.unlink()
            with transaction(paths.database) as connection:
                for row in rows:
                    connection.execute("DELETE FROM assets WHERE id=?", (row["id"],))
                    connection.execute(
                        "UPDATE crop_outputs SET phase='undone' WHERE id=?", (row["id"],)
                    )
                connection.execute(
                    "UPDATE crop_operations SET status='undone' WHERE id=?", (operation_id,)
                )
                connection.execute(
                    "UPDATE preprocess_operations SET status='undone' WHERE id=?", (operation_id,)
                )
        except Exception as error:
            try:
                restore_undo(paths, operation_id)
            except Exception as restore_error:
                finish(
                    paths.database, operation_id, "undoing", f"裁剪撤销恢复失败：{restore_error}"
                )
                raise CropExecutionError(
                    f"裁剪撤销失败且恢复未完成：operation={operation_id}；{error}；{restore_error}"
                ) from error
            raise CropExecutionError(
                f"裁剪撤销失败，已恢复本次结果：operation={operation_id}；原因={error}"
            ) from error
        return operation(paths.database, operation_id)


def restore_undo(paths: WorkspacePaths, operation_id: str) -> None:
    backup = paths.recovery / operation_id / "crop-undo"
    rows = output_rows(paths.database, operation_id)
    for row in rows:
        cleanup_staging(paths, row)
        original = safe_path(paths.root, str(row["relative_path"]))
        saved = backup / f"{row['id']}.png"
        if saved.exists():
            if file_sha256(saved) != str(row["output_hash"]):
                raise ValueError(f"撤销恢复副本发生变化：{saved}")
            if original.exists():
                if not owns_file(original, row):
                    raise ValueError(f"撤销恢复目标出现新文件，拒绝覆盖：{original}")
            else:
                publish_copy(
                    paths, str(row["id"]), str(row["relative_path"]), saved, str(row["output_hash"])
                )
            check_output(paths, row)
            saved.unlink()
        check_output(paths, row)
    backup.rmdir()
    finish(paths.database, operation_id, "succeeded", None)


def recover_orphaned(workspaces: WorkspaceService) -> int:
    recovered = 0
    for workspace in workspaces.list_recent():
        if not workspace.exists:
            continue
        paths, _ = workspaces.get(workspace.project_id)
        with closing(connect(paths.database)) as connection:
            rows = connection.execute(
                "SELECT id FROM crop_operations "
                "WHERE status IN ('running','recovery_failed','undoing')"
            ).fetchall()
        for row in rows:
            operation_id = str(row[0])
            undoing = operation(paths.database, operation_id).status == "undoing"
            try:
                if undoing:
                    restore_undo(paths, operation_id)
                else:
                    rollback_outputs(paths, operation_id)
                    finish(
                        paths.database,
                        operation_id,
                        "failed",
                        "进程中断，已回滚本次新增裁剪结果。",
                    )
            except (OSError, ValueError, RuntimeError) as error:
                message = f"裁剪中断恢复失败：operation={operation_id}，原因={error}"
                # Preserve undo intent so the next recovery never deletes successful outputs.
                finish(
                    paths.database,
                    operation_id,
                    "undoing" if undoing else "recovery_failed",
                    message,
                )
                logger.error(
                    "Crop recovery requires intervention",
                    extra={
                        "project_id": workspace.project_id,
                        "operation_id": operation_id,
                        "recovery_error": str(error),
                    },
                    exc_info=True,
                )
            else:
                recovered += 1
    return recovered
