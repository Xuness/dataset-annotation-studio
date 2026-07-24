from __future__ import annotations

import hashlib
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from glob import escape as escape_glob
from pathlib import Path

from dataset_studio.core.languages import LANGUAGE_PATTERN, normalize_language_code
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationStatus,
)
from dataset_studio.modules.annotations.repository import (
    EXPECTED_HEAD_UNSET,
    AnnotationRepository,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.workspaces.paths import WorkspacePaths


@dataclass(frozen=True, slots=True)
class _LegacyText:
    asset_id: str
    image_hash: str
    relative_path: str
    channel: AnnotationChannel
    language: str
    content: str
    raw_bytes: bytes | None
    source_hash: str
    modified_ns: int
    validation_status: AnnotationStatus


def ensure_database_annotation_store(paths: WorkspacePaths) -> int:
    """Import legacy sidecars exactly once, then make SQLite authoritative."""

    state = _state(paths.database)
    if state is None or str(state["mode"]) == "database":
        return int(state["imported_file_count"]) if state else 0

    legacy_files = _read_legacy_files(paths)
    history_count = _legacy_history_count(paths.database)
    backup_relative_path: str | None = None
    if legacy_files or history_count:
        backup = _backup_database(paths)
        backup_relative_path = backup.relative_to(paths.root).as_posix()

    repository = AnnotationRepository(paths.database)
    imported_at = utc_now_iso()
    with transaction(paths.database) as connection:
        current_state = connection.execute(
            "SELECT mode, imported_file_count FROM annotation_store_state WHERE singleton = 1"
        ).fetchone()
        if current_state is None or str(current_state["mode"]) == "database":
            return int(current_state["imported_file_count"]) if current_state else 0
        _import_legacy_history(connection, repository)
        revision_by_asset: dict[str, str] = {}
        for item in legacy_files:
            write = repository.write_text_in_transaction(
                connection,
                asset_id=item.asset_id,
                channel=item.channel,
                language=item.language,
                content=item.content,
                raw_bytes=item.raw_bytes,
                source="legacy_txt_import",
                validation_status=item.validation_status,
                image_content_hash=item.image_hash,
                expected_head_revision_id=EXPECTED_HEAD_UNSET,
                confirm=True,
                source_job_item_id=None,
                input_revisions=(
                    [(revision_by_asset[item.asset_id], "translation_source")]
                    if item.channel == AnnotationChannel.TRANSLATION
                    and item.asset_id in revision_by_asset
                    else ()
                ),
                metadata={
                    "source_relative_path": item.relative_path,
                    "source_hash": item.source_hash,
                    "source_modified_ns": item.modified_ns,
                },
                allow_candidate_on_conflict=False,
            )
            if item.channel == AnnotationChannel.EXISTING:
                revision_by_asset[item.asset_id] = write.revision_id
            connection.execute(
                """
                INSERT INTO legacy_annotation_imports (
                    id, asset_id, source_relative_path, source_hash,
                    source_modified_ns, channel, language, revision_id, imported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    item.asset_id,
                    item.relative_path,
                    item.source_hash,
                    item.modified_ns,
                    item.channel.value,
                    item.language,
                    write.revision_id,
                    imported_at,
                ),
            )
        connection.execute(
            """
            UPDATE annotation_store_state
            SET mode = 'database', backup_relative_path = ?,
                imported_file_count = ?, imported_at = ?
            WHERE singleton = 1
            """,
            (backup_relative_path, len(legacy_files), imported_at),
        )
    return len(legacy_files)


def _state(database_path: Path):
    connection = connect(database_path)
    try:
        return connection.execute(
            "SELECT * FROM annotation_store_state WHERE singleton = 1"
        ).fetchone()
    finally:
        connection.close()


def _legacy_history_count(database_path: Path) -> int:
    connection = connect(database_path)
    try:
        return int(connection.execute("SELECT COUNT(*) FROM annotation_revisions").fetchone()[0])
    finally:
        connection.close()


def _read_legacy_files(paths: WorkspacePaths) -> list[_LegacyText]:
    connection = connect(paths.database)
    try:
        assets = connection.execute(
            """
            SELECT id, relative_path, annotation_relative_path, content_hash
            FROM assets
            WHERE is_present = 1
            ORDER BY relative_path COLLATE NOCASE
            """
        ).fetchall()
    finally:
        connection.close()

    root = paths.root.resolve()
    items: list[_LegacyText] = []
    claimed_annotation_paths = {
        filesystem_path_key(root / str(row["annotation_relative_path"])) for row in assets
    }
    for asset in assets:
        annotation_path = root / str(asset["annotation_relative_path"])
        existing = _read_candidate(
            root,
            annotation_path,
            asset_id=str(asset["id"]),
            image_hash=str(asset["content_hash"]),
            channel=AnnotationChannel.EXISTING,
            language="",
        )
        if existing is not None:
            items.append(existing)

        prefix = f"{annotation_path.stem}."
        if not annotation_path.parent.is_dir():
            continue
        for candidate in annotation_path.parent.glob(f"{escape_glob(annotation_path.stem)}.*.txt"):
            if filesystem_path_key(candidate) in claimed_annotation_paths:
                continue
            raw_language = candidate.name[len(prefix) : -len(".txt")]
            if not LANGUAGE_PATTERN.fullmatch(raw_language):
                continue
            language = normalize_language_code(raw_language)
            translation = _read_candidate(
                root,
                candidate,
                asset_id=str(asset["id"]),
                image_hash=str(asset["content_hash"]),
                channel=AnnotationChannel.TRANSLATION,
                language=language,
            )
            if translation is not None:
                items.append(translation)
    items.sort(
        key=lambda item: (
            item.asset_id,
            item.channel == AnnotationChannel.TRANSLATION,
            item.language,
        )
    )
    return items


def _read_candidate(
    root: Path,
    path: Path,
    *,
    asset_id: str,
    image_hash: str,
    channel: AnnotationChannel,
    language: str,
) -> _LegacyText | None:
    if path.is_symlink() or not path.is_file():
        return None
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        return None
    payload = path.read_bytes()
    raw_bytes: bytes | None = None
    try:
        content = payload.decode("utf-8-sig")
        validation = validate_tag_balance(content)
        validation_status = validation.status
    except UnicodeDecodeError:
        content = payload.decode("utf-8", errors="replace")
        raw_bytes = payload
        validation_status = AnnotationStatus.ENCODING_ERROR
    stat = path.stat()
    return _LegacyText(
        asset_id=asset_id,
        image_hash=image_hash,
        relative_path=path.relative_to(root).as_posix(),
        channel=channel,
        language=language,
        content=content,
        raw_bytes=raw_bytes,
        source_hash=hashlib.sha256(payload).hexdigest(),
        modified_ns=stat.st_mtime_ns,
        validation_status=validation_status,
    )


def _import_legacy_history(
    connection: sqlite3.Connection,
    repository: AnnotationRepository,
) -> None:
    rows = connection.execute(
        """
        SELECT r.*, a.content_hash
        FROM annotation_revisions r
        JOIN assets a ON a.id = r.asset_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM annotation_document_revisions imported
            WHERE imported.metadata_json LIKE
                '%"legacy_revision_id":"' || r.id || '"%'
        )
        ORDER BY r.asset_id, r.created_at, r.rowid
        """
    ).fetchall()
    imported_asset_ids: set[str] = set()
    for row in rows:
        write = repository.write_text_in_transaction(
            connection,
            asset_id=str(row["asset_id"]),
            channel=AnnotationChannel.EXISTING,
            language="",
            content=str(row["content"]),
            raw_bytes=None,
            source=f"legacy_history:{row['source']}",
            validation_status=AnnotationStatus(str(row["validation_status"])),
            image_content_hash=str(row["content_hash"]),
            expected_head_revision_id=EXPECTED_HEAD_UNSET,
            confirm=False,
            source_job_item_id=None,
            input_revisions=(),
            metadata={"legacy_revision_id": str(row["id"])},
            allow_candidate_on_conflict=False,
        )
        # Old revision rows are historical evidence, not proof that a sidecar
        # still existed at migration time. Keep them in channel history without
        # reviving deleted or externally removed annotations as the active head.
        connection.execute(
            """
            UPDATE annotation_document_revisions
            SET is_candidate = 1
            WHERE id = ?
            """,
            (write.revision_id,),
        )
        connection.execute(
            """
            UPDATE annotation_documents
            SET head_revision_id = NULL, confirmed_revision_id = NULL
            WHERE id = ?
            """,
            (write.document_id,),
        )
        imported_asset_ids.add(str(row["asset_id"]))
    for asset_id in imported_asset_ids:
        repository.sync_asset_summary_in_transaction(connection, asset_id)


def _backup_database(paths: WorkspacePaths) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = paths.history / f"pre-annotation-store-v2-{timestamp}.sqlite3"
    suffix = 1
    while destination.exists():
        destination = paths.history / f"pre-annotation-store-v2-{timestamp}-{suffix}.sqlite3"
        suffix += 1

    source = connect(paths.database)
    target = sqlite3.connect(destination)
    try:
        source.execute("PRAGMA wal_checkpoint(FULL)")
        source.backup(target)
        result = target.execute("PRAGMA integrity_check").fetchone()
        if result is None or str(result[0]).lower() != "ok":
            raise RuntimeError("迁移前数据库备份未通过完整性检查。")
    finally:
        target.close()
        source.close()
    return destination
