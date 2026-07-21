from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import AnnotationStatus
from dataset_studio.modules.annotations.text import decode_annotation_bytes
from dataset_studio.modules.exports.models import (
    ExportPreview,
    ExportPreviewItem,
    ExportRequest,
    ExportScope,
)


@dataclass(frozen=True, slots=True)
class ExportPlanItem:
    asset_id: str
    source_relative_path: str
    annotation_relative_path: str
    target_image_name: str
    target_annotation_name: str
    image_hash: str
    image_size: int
    image_modified_ns: int
    annotation_exists: bool
    annotation_hash: str | None
    annotation_size: int
    annotation_modified_ns: int | None
    annotation_status: str
    warning_code: str | None
    warning_message: str | None
    blocking_issue: str | None


@dataclass(frozen=True, slots=True)
class ExportPlan:
    destination_path: str
    items: list[ExportPlanItem]
    blocking_issues: list[str]


def build_plan(
    database_path: Path,
    workspace_root: Path,
    request: ExportRequest,
) -> ExportPlan:
    root = workspace_root.resolve()
    destination, global_issues = _validate_destination(root, request.destination_path)
    rows, selection_issues = _select_assets(database_path, request)
    global_issues.extend(selection_issues)

    items = [_plan_item(root, row) for row in rows]
    items = _mark_flattened_name_collisions(items)
    if not items:
        global_issues.append("当前导出范围内没有图片。")
    return ExportPlan(
        destination_path=str(destination),
        items=items,
        blocking_issues=list(dict.fromkeys(global_issues)),
    )


def preview_token(request: ExportRequest, plan: ExportPlan) -> str:
    payload = {
        "request": {
            **request.model_dump(mode="json"),
            "asset_ids": sorted(request.asset_ids),
        },
        "destination_path": plan.destination_path,
        "items": [asdict(item) for item in plan.items],
        "blocking_issues": plan.blocking_issues,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def to_preview(request: ExportRequest, plan: ExportPlan) -> ExportPreview:
    visible = plan.items[:1000]
    visible_ids = {item.asset_id for item in visible}
    visible.extend(
        item
        for item in plan.items
        if (item.warning_code or item.blocking_issue) and item.asset_id not in visible_ids
    )
    visible = visible[:2000]
    statuses = [item.annotation_status for item in plan.items]
    blocking_issue_count = len(plan.blocking_issues) + sum(
        item.blocking_issue is not None for item in plan.items
    )
    return ExportPreview(
        items=[
            ExportPreviewItem(
                asset_id=item.asset_id,
                source_relative_path=item.source_relative_path,
                target_image_name=item.target_image_name,
                target_annotation_name=item.target_annotation_name,
                annotation_status=item.annotation_status,
                image_bytes=item.image_size,
                annotation_bytes=item.annotation_size,
                warning_code=item.warning_code,
                warning_message=item.warning_message,
                blocking_issue=item.blocking_issue,
            )
            for item in visible
        ],
        total_items=len(plan.items),
        truncated=len(visible) < len(plan.items),
        image_bytes=sum(item.image_size for item in plan.items),
        annotation_bytes=sum(item.annotation_size for item in plan.items),
        valid_count=statuses.count(AnnotationStatus.VALID.value),
        manually_accepted_count=statuses.count(AnnotationStatus.MANUALLY_ACCEPTED.value),
        missing_count=statuses.count(AnnotationStatus.MISSING.value),
        empty_count=statuses.count(AnnotationStatus.EMPTY.value),
        invalid_count=statuses.count(AnnotationStatus.INVALID.value),
        encoding_error_count=statuses.count("encoding_error"),
        warning_count=sum(item.warning_code is not None for item in plan.items),
        blocking_issue_count=blocking_issue_count,
        blocking_issues=plan.blocking_issues,
        preview_token=preview_token(request, plan),
    )


def _validate_destination(root: Path, raw_destination: str) -> tuple[Path, list[str]]:
    issues: list[str] = []
    try:
        destination = Path(raw_destination).expanduser().resolve()
    except (OSError, RuntimeError) as error:
        return Path(raw_destination), [f"无法解析导出目录：{error}"]

    if destination == root or destination.is_relative_to(root):
        issues.append("导出目录不能位于当前项目内部。")
    if not destination.exists():
        issues.append("导出目录不存在，请通过目录选择器选择一个空文件夹。")
    elif not destination.is_dir():
        issues.append("选择的导出路径不是文件夹。")
    else:
        try:
            if any(destination.iterdir()):
                issues.append("导出目录必须为空，以避免覆盖已有文件。")
        except OSError as error:
            issues.append(f"无法读取导出目录：{error}")
    return destination, issues


def _select_assets(database_path: Path, request: ExportRequest):
    connection = connect(database_path)
    try:
        if request.scope == ExportScope.ALL:
            rows = connection.execute(
                "SELECT * FROM assets WHERE is_present = 1 ORDER BY relative_path COLLATE NOCASE"
            ).fetchall()
            return rows, []

        rows = []
        for start in range(0, len(request.asset_ids), 500):
            batch = request.asset_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows.extend(
                connection.execute(
                    f"""
                    SELECT * FROM assets
                    WHERE is_present = 1 AND id IN ({placeholders})
                    """,
                    batch,
                ).fetchall()
            )
        found_ids = {str(row["id"]) for row in rows}
        missing_count = len(set(request.asset_ids) - found_ids)
        issues = (
            [f"选中的图片中有 {missing_count} 项已经不存在，请重新选择。"] if missing_count else []
        )
        rows.sort(key=lambda row: str(row["relative_path"]).casefold())
        return rows, issues
    finally:
        connection.close()


def _plan_item(root: Path, row) -> ExportPlanItem:
    source_relative_path = str(row["relative_path"])
    annotation_relative_path = str(row["annotation_relative_path"])
    source = (root / source_relative_path).resolve()
    annotation = (root / annotation_relative_path).resolve()
    blocking_issue = None

    if not source.is_relative_to(root):
        blocking_issue = "图片路径超出当前项目范围。"
        image_size = 0
        image_modified_ns = 0
    elif not source.is_file():
        blocking_issue = "图片已经不存在，请重新扫描项目。"
        image_size = 0
        image_modified_ns = 0
    else:
        try:
            stat = source.stat()
            image_size = stat.st_size
            image_modified_ns = stat.st_mtime_ns
            if image_size != int(row["byte_size"]) or image_modified_ns != int(row["modified_ns"]):
                blocking_issue = "图片自上次扫描后发生了变化，请先重新扫描项目。"
        except OSError as error:
            image_size = 0
            image_modified_ns = 0
            blocking_issue = f"无法读取图片状态：{error}"

    (
        annotation_exists,
        annotation_hash,
        annotation_size,
        annotation_modified_ns,
        annotation_status,
        warning_code,
        warning_message,
        annotation_blocking_issue,
    ) = _annotation_snapshot(annotation, root, row)
    if annotation_blocking_issue:
        blocking_issue = (
            f"{blocking_issue}；{annotation_blocking_issue}"
            if blocking_issue
            else annotation_blocking_issue
        )

    return ExportPlanItem(
        asset_id=str(row["id"]),
        source_relative_path=source_relative_path,
        annotation_relative_path=annotation_relative_path,
        target_image_name=Path(source_relative_path).name,
        target_annotation_name=Path(annotation_relative_path).name,
        image_hash=str(row["content_hash"]),
        image_size=image_size,
        image_modified_ns=image_modified_ns,
        annotation_exists=annotation_exists,
        annotation_hash=annotation_hash,
        annotation_size=annotation_size,
        annotation_modified_ns=annotation_modified_ns,
        annotation_status=annotation_status,
        warning_code=warning_code,
        warning_message=warning_message,
        blocking_issue=blocking_issue,
    )


def _annotation_snapshot(annotation: Path, root: Path, row):
    if not annotation.is_relative_to(root):
        return (
            False,
            None,
            0,
            None,
            AnnotationStatus.MISSING.value,
            None,
            None,
            "标注路径超出当前项目范围。",
        )
    if not annotation.exists():
        return (
            False,
            None,
            0,
            None,
            AnnotationStatus.MISSING.value,
            "missing_annotation",
            "缺少同名 TXT；强制导出时只会复制图片。",
            None,
        )
    if not annotation.is_file():
        return (
            False,
            None,
            0,
            None,
            AnnotationStatus.MISSING.value,
            None,
            None,
            "同名标注路径不是普通文件。",
        )

    try:
        stat_before = annotation.stat()
        content = annotation.read_bytes()
        stat_after = annotation.stat()
    except OSError as error:
        return (
            True,
            None,
            0,
            None,
            AnnotationStatus.INVALID.value,
            None,
            None,
            f"无法读取同名 TXT：{error}",
        )
    if (stat_before.st_size, stat_before.st_mtime_ns) != (
        stat_after.st_size,
        stat_after.st_mtime_ns,
    ):
        return (
            True,
            None,
            stat_after.st_size,
            stat_after.st_mtime_ns,
            AnnotationStatus.INVALID.value,
            None,
            None,
            "同名 TXT 在校验过程中发生了变化，请重试。",
        )

    digest = hashlib.sha256(content).hexdigest()
    _, validation = decode_annotation_bytes(content)
    if validation.status == AnnotationStatus.ENCODING_ERROR:
        return (
            True,
            digest,
            stat_after.st_size,
            stat_after.st_mtime_ns,
            "encoding_error",
            "invalid_encoding",
            "同名 TXT 不是有效的 UTF-8；强制导出时会保留原始字节。",
            None,
        )

    stored_status = str(row["annotation_status"])
    stored_modified_ns = (
        int(row["annotation_modified_ns"]) if row["annotation_modified_ns"] is not None else None
    )
    status = (
        AnnotationStatus.MANUALLY_ACCEPTED
        if stored_status == AnnotationStatus.MANUALLY_ACCEPTED.value
        and stored_modified_ns == stat_after.st_mtime_ns
        else validation.status
    )
    warning_code = None
    warning_message = None
    if status == AnnotationStatus.EMPTY:
        warning_code = "empty_annotation"
        warning_message = "同名 TXT 内容为空；强制导出时会原样复制。"
    elif status == AnnotationStatus.INVALID:
        warning_code = "invalid_annotation"
        warning_message = (
            validation.issues[0].message if validation.issues else "同名 TXT 校验失败。"
        )
    return (
        True,
        digest,
        stat_after.st_size,
        stat_after.st_mtime_ns,
        status.value,
        warning_code,
        warning_message,
        None,
    )


def _mark_flattened_name_collisions(items: list[ExportPlanItem]) -> list[ExportPlanItem]:
    claims: dict[str, list[tuple[int, str]]] = {}
    for index, item in enumerate(items):
        claims.setdefault(item.target_image_name.casefold(), []).append(
            (index, item.target_image_name)
        )
        # Reserve the expected TXT name even when it is currently missing. Otherwise
        # another flattened pair could make a missing image appear annotated.
        claims.setdefault(item.target_annotation_name.casefold(), []).append(
            (index, item.target_annotation_name)
        )

    collisions: dict[int, set[str]] = {}
    for owners in claims.values():
        owner_indexes = {index for index, _ in owners}
        if len(owner_indexes) <= 1:
            continue
        names = {name for _, name in owners}
        for index in owner_indexes:
            collisions.setdefault(index, set()).update(names)

    result = list(items)
    for index, names in collisions.items():
        display_names = "、".join(sorted(names, key=str.casefold))
        issue = f"扁平导出后存在同名文件冲突：{display_names}"
        previous = result[index].blocking_issue
        result[index] = replace(
            result[index],
            blocking_issue=f"{previous}；{issue}" if previous else issue,
        )
    return result
