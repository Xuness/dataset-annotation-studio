from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.modules.preprocessing.executor import PreparedItem
from dataset_studio.modules.workspaces.paths import WorkspacePaths

if TYPE_CHECKING:
    from dataset_studio.modules.preprocessing.service import PreprocessService


def commit_prepared_item(
    service: PreprocessService, paths: WorkspacePaths, prepared: PreparedItem
) -> None:
    item = prepared.plan
    source = paths.root / item.before_relative_path
    target = paths.root / item.after_relative_path
    paths_differ = item.before_relative_path != item.after_relative_path
    source_stat = source.stat()
    if (
        source_stat.st_size != prepared.source_size
        or source_stat.st_mtime_ns != prepared.source_modified_ns
    ):
        raise ValueError(f"源文件在并发准备后发生了变化：{item.before_relative_path}")
    if paths_differ and target.exists() and not service._same_file(source, target):
        raise ValueError(f"目标文件在执行前已出现，拒绝覆盖：{item.after_relative_path}")
    target_was_source = paths_differ and service._same_file(source, target)
    sidecars = service._sidecar_paths(
        source,
        target,
        prepared.recovery_path,
        service._claimed_annotation_paths(paths.database, paths.root),
    )
    sidecar_states: list[tuple[Path, Path, Path, bool]] = []
    for before_sidecar, after_sidecar, recovery_sidecar in sidecars:
        if after_sidecar.exists() and not service._same_file(before_sidecar, after_sidecar):
            raise ValueError(
                f"目标同名伴随文件在执行前已出现，拒绝覆盖：{after_sidecar.relative_to(paths.root)}"
            )
        existed = before_sidecar.is_file()
        if existed:
            atomic_copy_file(before_sidecar, recovery_sidecar)
        sidecar_states.append((before_sidecar, after_sidecar, recovery_sidecar, existed))
    moved_sidecars: list[tuple[Path, Path, Path]] = []
    try:
        if prepared.staging_path is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(prepared.staging_path, target)
            if paths_differ and not target_was_source:
                source.unlink()
        elif paths_differ:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, target)
        for before_sidecar, after_sidecar, recovery_sidecar, existed in sidecar_states:
            if existed:
                if not before_sidecar.is_file():
                    raise ValueError(
                        f"同名伴随文件在执行期间发生了变化："
                        f"{before_sidecar.relative_to(paths.root)}"
                    )
                if after_sidecar.exists() and not service._same_file(before_sidecar, after_sidecar):
                    raise ValueError(
                        f"目标同名伴随文件在执行前已出现，拒绝覆盖："
                        f"{after_sidecar.relative_to(paths.root)}"
                    )
                after_sidecar.parent.mkdir(parents=True, exist_ok=True)
                os.replace(before_sidecar, after_sidecar)
                moved_sidecars.append((before_sidecar, after_sidecar, recovery_sidecar))
            elif before_sidecar.exists():
                raise ValueError(
                    f"同名伴随文件在执行期间发生了变化：{before_sidecar.relative_to(paths.root)}"
                )
        service._update_asset(
            paths.database,
            item.asset_id,
            target,
            paths.root,
            prepared.after_hash,
            item.after_width,
            item.after_height,
        )
    except BaseException as error:
        compensation_errors: list[str] = []
        try:
            service._restore_executed_sidecars(moved_sidecars)
        except Exception as sidecar_error:
            compensation_errors.append(f"伴随文件恢复失败：{sidecar_error}")
        try:
            service._restore_file(
                source,
                target,
                prepared.recovery_path,
                paths_differ=paths_differ,
            )
        except Exception as image_error:
            compensation_errors.append(f"图片恢复失败：{image_error}")
        if compensation_errors:
            raise RuntimeError("；".join(compensation_errors)) from error
        raise
