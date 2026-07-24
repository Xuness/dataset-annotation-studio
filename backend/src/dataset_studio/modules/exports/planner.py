from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import AnnotationChannel
from dataset_studio.modules.exports.models import (
    ExportChannelSelection,
    ExportFormat,
    ExportPreview,
    ExportPreviewItem,
    ExportRequest,
    ExportRevisionMode,
    ExportScope,
)


@dataclass(frozen=True, slots=True)
class ExportArtifact:
    kind: str
    target_relative_path: str
    source_relative_path: str | None
    source_revision_id: str | None
    content: str | None
    raw_base64: str | None
    content_hash: str
    byte_size: int
    source_modified_ns: int | None


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
    channel_statuses: dict[str, str]
    artifacts: tuple[ExportArtifact, ...]
    warning_code: str | None
    warning_message: str | None
    blocking_issue: str | None


@dataclass(frozen=True, slots=True)
class ExportPlan:
    destination_path: str
    items: list[ExportPlanItem]
    blocking_issues: list[str]


@dataclass(frozen=True, slots=True)
class _SelectedAnnotation:
    selection: ExportChannelSelection
    revision_id: str | None
    availability_status: str
    review_status: str | None
    validation_status: str | None
    content: str | None
    raw_bytes: bytes | None
    tags: list[dict[str, object]]


def build_plan(
    database_path: Path,
    workspace_root: Path,
    request: ExportRequest,
) -> ExportPlan:
    root = workspace_root.resolve()
    destination, global_issues = _validate_destination(root, request.destination_path)
    rows, selection_issues = _select_assets(database_path, request)
    global_issues.extend(selection_issues)
    annotations = _load_annotations(database_path, rows, request.channels)

    items = [
        _plan_item(
            root,
            row,
            request,
            annotations.get(str(row["id"]), {}),
        )
        for row in rows
    ]
    items = _mark_target_collisions(items)
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
                target_outputs=[artifact.target_relative_path for artifact in item.artifacts],
                channel_statuses=item.channel_statuses,
                annotation_status=item.annotation_status,
                image_bytes=sum(
                    artifact.byte_size for artifact in item.artifacts if artifact.kind == "image"
                ),
                annotation_bytes=item.annotation_size,
                warning_code=item.warning_code,
                warning_message=item.warning_message,
                blocking_issue=item.blocking_issue,
            )
            for item in visible
        ],
        total_items=len(plan.items),
        truncated=len(visible) < len(plan.items),
        image_bytes=sum(
            artifact.byte_size
            for item in plan.items
            for artifact in item.artifacts
            if artifact.kind == "image"
        ),
        annotation_bytes=sum(item.annotation_size for item in plan.items),
        usable_count=statuses.count("usable") + statuses.count("reviewed"),
        reviewed_count=statuses.count("reviewed"),
        missing_count=statuses.count("missing"),
        empty_count=statuses.count("empty"),
        invalid_count=statuses.count("invalid"),
        encoding_error_count=statuses.count("encoding_error"),
        unreviewed_count=statuses.count("usable"),
        stale_count=statuses.count("stale"),
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


def _load_annotations(
    database_path: Path,
    assets,
    selections: list[ExportChannelSelection],
) -> dict[str, dict[str, _SelectedAnnotation]]:
    asset_ids = [str(row["id"]) for row in assets]
    result: dict[str, dict[str, _SelectedAnnotation]] = {asset_id: {} for asset_id in asset_ids}
    if not asset_ids:
        return result
    connection = connect(database_path)
    try:
        for start in range(0, len(asset_ids), 400):
            batch = asset_ids[start : start + 400]
            placeholders = ",".join("?" for _ in batch)
            document_rows = connection.execute(
                f"""
                SELECT d.*, a.content_hash AS current_image_hash
                FROM annotation_documents d
                JOIN assets a ON a.id = d.asset_id
                WHERE d.asset_id IN ({placeholders})
                """,
                batch,
            ).fetchall()
            documents = {
                (str(row["asset_id"]), str(row["channel"]), str(row["language"])): row
                for row in document_rows
            }
            for asset_id in batch:
                for selection in selections:
                    key = selection.key
                    document = documents.get(
                        (asset_id, selection.channel.value, selection.language)
                    )
                    result[asset_id][key] = _selected_annotation(
                        connection,
                        selection,
                        document,
                    )
    finally:
        connection.close()
    return result


def _selected_annotation(
    connection,
    selection: ExportChannelSelection,
    document,
) -> _SelectedAnnotation:
    if document is None:
        return _missing_selection(selection)
    pointer = (
        document["reviewed_revision_id"]
        if selection.revision == ExportRevisionMode.REVIEWED
        else document["head_revision_id"]
    )
    if not pointer:
        return _missing_selection(selection)
    revision = connection.execute(
        """
        SELECT *
        FROM annotation_document_revisions
        WHERE id = ?
        """,
        (str(pointer),),
    ).fetchone()
    if revision is None or bool(revision["is_tombstone"]):
        return _missing_selection(selection)
    validation_status = str(revision["validation_status"])
    if str(revision["image_content_hash"]) != str(document["current_image_hash"]):
        availability_status = "stale"
    elif validation_status in {"invalid", "encoding_error", "empty", "unchecked"}:
        availability_status = "invalid"
    else:
        availability_status = "usable"
    review_status = (
        "reviewed" if str(document["reviewed_revision_id"] or "") == str(pointer) else "unreviewed"
    )

    if selection.channel == AnnotationChannel.TAGS:
        tags = [
            {
                "name": str(row["name"]),
                "category": str(row["category"]) if row["category"] else None,
                "confidence": (float(row["confidence"]) if row["confidence"] is not None else None),
                "origin": str(row["origin"]),
            }
            for row in connection.execute(
                """
                SELECT name, category, confidence, origin
                FROM annotation_tag_items
                WHERE revision_id = ?
                ORDER BY position
                """,
                (str(pointer),),
            ).fetchall()
        ]
        content = ", ".join(str(tag["name"]) for tag in tags)
        raw_bytes = None
    else:
        text = connection.execute(
            """
            SELECT content, raw_bytes
            FROM annotation_text_contents
            WHERE revision_id = ?
            """,
            (str(pointer),),
        ).fetchone()
        content = str(text["content"]) if text else ""
        raw_bytes = text["raw_bytes"] if text else None
        tags = []
    return _SelectedAnnotation(
        selection=selection,
        revision_id=str(pointer),
        availability_status=availability_status,
        review_status=review_status,
        validation_status=validation_status,
        content=content,
        raw_bytes=raw_bytes,
        tags=tags,
    )


def _missing_selection(selection: ExportChannelSelection) -> _SelectedAnnotation:
    return _SelectedAnnotation(
        selection=selection,
        revision_id=None,
        availability_status="missing",
        review_status=None,
        validation_status=None,
        content=None,
        raw_bytes=None,
        tags=[],
    )


def _plan_item(
    root: Path,
    row,
    request: ExportRequest,
    annotations: dict[str, _SelectedAnnotation],
) -> ExportPlanItem:
    source_relative_path = str(row["relative_path"])
    source = (root / source_relative_path).resolve()
    blocking_issue = None
    if not source.is_relative_to(root):
        blocking_issue = "图片路径超出当前项目范围。"
    elif not source.is_file():
        blocking_issue = "图片已经不存在，请重新扫描项目。"
    else:
        stat = source.stat()
        if stat.st_size != int(row["byte_size"]) or stat.st_mtime_ns != int(row["modified_ns"]):
            blocking_issue = "图片在上次扫描后发生了变化，请重新扫描项目。"
        elif file_sha256(source) != str(row["content_hash"]):
            blocking_issue = "图片内容与工作区索引不一致，请重新扫描项目。"

    source_name = PurePosixPath(source_relative_path).name
    stem = PurePosixPath(source_name).stem
    artifacts: list[ExportArtifact] = []
    statuses = {key: _selection_status(selected) for key, selected in annotations.items()}
    multiple_txt_channels = ExportFormat.TXT in request.formats and len(request.channels) > 1

    if ExportFormat.TXT in request.formats:
        for selection in request.channels:
            selected = annotations[selection.key]
            directory = _channel_directory(selection) if multiple_txt_channels else ""
            image_target = _join_target(directory, source_name)
            artifacts.append(_image_artifact(row, image_target))
            if selected.revision_id is not None:
                annotation_target = _join_target(directory, f"{stem}.txt")
                artifacts.append(_annotation_artifact(selected, annotation_target))
    elif ExportFormat.JSON in request.formats:
        artifacts.append(_image_artifact(row, source_name))

    if ExportFormat.JSON in request.formats:
        directory = "metadata" if multiple_txt_channels else ""
        target = _join_target(directory, f"{stem}.annotations.json")
        payload = {
            "schema_version": 1,
            "image": source_name,
            "source_relative_path": source_relative_path,
            "annotations": {
                key: {
                    "revision_id": selected.revision_id,
                    "availability_status": selected.availability_status,
                    "review_status": selected.review_status,
                    "validation_status": selected.validation_status,
                    **(
                        {"tags": selected.tags}
                        if selected.selection.channel == AnnotationChannel.TAGS
                        else {"content": selected.content}
                    ),
                }
                for key, selected in annotations.items()
            },
        }
        content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        encoded = content.encode("utf-8")
        artifacts.append(
            ExportArtifact(
                kind="json",
                target_relative_path=target,
                source_relative_path=None,
                source_revision_id=None,
                content=content,
                raw_base64=None,
                content_hash=hashlib.sha256(encoded).hexdigest(),
                byte_size=len(encoded),
                source_modified_ns=None,
            )
        )

    warnings: list[str] = []
    if any(status == "missing" for status in statuses.values()):
        warnings.append("部分所选标注通道缺少可导出的版本。")
    if any(status == "stale" for status in statuses.values()):
        warnings.append("导出范围包含图片变化后的过期标注。")
    invalid_statuses = {
        selected.validation_status
        for selected in annotations.values()
        if selected.validation_status in {"invalid", "encoding_error", "empty", "unchecked"}
    }
    if invalid_statuses:
        warnings.append("导出范围包含校验异常的标注。")

    annotation_artifacts = [artifact for artifact in artifacts if artifact.kind != "image"]
    first_image = next(
        (artifact.target_relative_path for artifact in artifacts if artifact.kind == "image"),
        source_name,
    )
    first_annotation = next(
        (artifact.target_relative_path for artifact in artifacts if artifact.kind != "image"),
        f"{stem}.txt",
    )
    combined_hash = (
        hashlib.sha256(
            "".join(artifact.content_hash for artifact in annotation_artifacts).encode("ascii")
        ).hexdigest()
        if annotation_artifacts
        else None
    )
    aggregate_status = _aggregate_status(annotations.values())
    return ExportPlanItem(
        asset_id=str(row["id"]),
        source_relative_path=source_relative_path,
        annotation_relative_path=str(row["annotation_relative_path"]),
        target_image_name=first_image,
        target_annotation_name=first_annotation,
        image_hash=str(row["content_hash"]),
        image_size=int(row["byte_size"]),
        image_modified_ns=int(row["modified_ns"]),
        annotation_exists=bool(annotation_artifacts),
        annotation_hash=combined_hash,
        annotation_size=sum(artifact.byte_size for artifact in annotation_artifacts),
        annotation_modified_ns=None,
        annotation_status=aggregate_status,
        channel_statuses=statuses,
        artifacts=tuple(artifacts),
        warning_code="annotation_warning" if warnings else None,
        warning_message=" ".join(warnings) if warnings else None,
        blocking_issue=blocking_issue,
    )


def _image_artifact(row, target: str) -> ExportArtifact:
    return ExportArtifact(
        kind="image",
        target_relative_path=target,
        source_relative_path=str(row["relative_path"]),
        source_revision_id=None,
        content=None,
        raw_base64=None,
        content_hash=str(row["content_hash"]),
        byte_size=int(row["byte_size"]),
        source_modified_ns=int(row["modified_ns"]),
    )


def _annotation_artifact(
    selected: _SelectedAnnotation,
    target: str,
) -> ExportArtifact:
    raw_bytes = selected.raw_bytes
    if raw_bytes is not None:
        content_hash = hashlib.sha256(raw_bytes).hexdigest()
        byte_size = len(raw_bytes)
        raw_base64 = base64.b64encode(raw_bytes).decode("ascii")
        content = None
    else:
        content = selected.content or ""
        encoded = content.encode("utf-8")
        content_hash = hashlib.sha256(encoded).hexdigest()
        byte_size = len(encoded)
        raw_base64 = None
    return ExportArtifact(
        kind="annotation",
        target_relative_path=target,
        source_relative_path=None,
        source_revision_id=selected.revision_id,
        content=content,
        raw_base64=raw_base64,
        content_hash=content_hash,
        byte_size=byte_size,
        source_modified_ns=None,
    )


def _aggregate_status(values) -> str:
    selections = list(values)
    for validation in ("encoding_error", "invalid", "empty", "unchecked"):
        if any(selected.validation_status == validation for selected in selections):
            return validation
    for availability in ("stale", "missing"):
        if any(selected.availability_status == availability for selected in selections):
            return availability
    if selections and all(selected.review_status == "reviewed" for selected in selections):
        return "reviewed"
    return "usable"


def _selection_status(selected: _SelectedAnnotation) -> str:
    if selected.availability_status != "usable":
        if selected.availability_status == "invalid" and selected.validation_status:
            return selected.validation_status
        return selected.availability_status
    return "reviewed" if selected.review_status == "reviewed" else "usable"


def _channel_directory(selection: ExportChannelSelection) -> str:
    if selection.channel == AnnotationChannel.EXISTING:
        return "existing"
    if selection.channel == AnnotationChannel.DESCRIPTION:
        return "description"
    if selection.channel == AnnotationChannel.TAGS:
        return "tags"
    return f"translation-{selection.language}"


def _join_target(directory: str, name: str) -> str:
    return f"{directory}/{name}" if directory else name


def _mark_target_collisions(items: list[ExportPlanItem]) -> list[ExportPlanItem]:
    owners: dict[str, list[int]] = {}
    for index, item in enumerate(items):
        for artifact in item.artifacts:
            owners.setdefault(artifact.target_relative_path.casefold(), []).append(index)
    collided = {index for indices in owners.values() if len(indices) > 1 for index in indices}
    if not collided:
        return items
    return [
        ExportPlanItem(
            **{
                **asdict(item),
                "artifacts": item.artifacts,
                "blocking_issue": (
                    "扁平化后多个素材会写入同一个目标文件，请重命名源文件。"
                    if index in collided
                    else item.blocking_issue
                ),
            }
        )
        for index, item in enumerate(items)
    ]
