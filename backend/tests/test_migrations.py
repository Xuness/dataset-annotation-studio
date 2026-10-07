import importlib
import pkgutil
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from dataset_studio.core.config import Settings
from dataset_studio.core.migrations import Migration, migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.workspaces.models import WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    WORKSPACE_SCHEMA_VERSION,
    initialize_workspace_database,
)
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database

EXPECTED_WORKSPACE_MIGRATION_CHECKSUMS = {
    1: "a7b50fece8e0aafa67b4c59636d4a616653ffb268a7e106b3ef3f39317609f60",
    2: "f9851a12e095767fa170c29f645f501051eb2c92cc065b916c1690ff3792ed6f",
    3: "050898ead57c796933f3663c7e4553fc03adcd8c05e74d4cb824a0a0aa0dad10",
    4: "fbd250cb4b4670a84fb9d71df3e876fa885402fcbd17a547d46079f373d393fa",
    5: "509fec77efed4abd2f929d27bd1ab3672e274da3263d558fe9471c9a30d7f5b1",
    6: "cef4042886ce8ecfb473b2c585139b957ffb830ea10e084a16873a6a89006b8c",
    7: "39800739573fe7cb2932f0ed85e6bb282f472ca5e481b5e8e1cc2d36a2239e53",
    8: "25e84380d067373e6fa1139613f0698b6985e24ccb09a98b0c4a1a10a3b650e9",
    9: "a3b1a418ea8ac88e5e5b4180e5da4bf4c4bdabbd28babb90d38cfbade1533210",
    10: "4e6862b1690e872d82f085ee4c58f7db337fbdd25abaf8034e70e234471fb1d0",
    11: "cc0040fe94536e7453ce876af0cf75d53441829154fcf5f5fd5e7315b5b37685",
    12: "313ef7efbc403b4bd46ac7cc65e77e32f2f178a053f866b1104560eab1e2c0fb",
    13: "05ae357184022303f22dcd49d4c53460844bfcc7ba9b05b37e0bbd75f00ad59c",
    14: "ec00973ffc0b07c4a531fe343cd88ab98b29b1511267bac0facca10edb4fe78e",
    15: "75e040ea6904594889def8a785ceecd13a6b4e5cddd17b234e96ee9dd70afdd5",
    16: "9b7e99492fe535f035db23760d3903be63c374abb5f21c3161412542b59fa12b",
    17: "ed30a1d11d3d3cf01a49aee9ee739778d20db94e956f7117190272c2e6c1d6c2",
    18: "5a9307e485bbc72f7092bf7bde8902bd6b383495ba2656329b3e7b1c960244ba",
    19: "0a1888b731c2e971b12d5a844a2439d0a9ce925472fade121933ac8f5e6d319e",
    20: "f2475fc69e1472cafd52243bc5b71202cb1d86023f0f1b37a344e251f55a566c",
    21: "73c6004567ad5d772a8e9cd1be33c5be6017abe53b4e9eb0ba3c9e30ee4bad87",
    22: "070a5d7b6e49c469cee56bd626a9698608954bd432e3ad1c5d4b6b9fd1b52707",
    23: "16c4a660b60112163100f2f6bcc91a8d387d2f12b4028ece9527bbaef1929084",
}


def test_workspace_migrations_are_isolated_and_immutable() -> None:
    from dataset_studio.modules.workspaces import migrations as migration_package

    expected_versions = list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
    assert [migration.version for migration in WORKSPACE_MIGRATIONS] == expected_versions
    assert len(WORKSPACE_MIGRATIONS) == WORKSPACE_SCHEMA_VERSION
    assert {
        migration.version: migration.checksum for migration in WORKSPACE_MIGRATIONS
    } == EXPECTED_WORKSPACE_MIGRATION_CHECKSUMS

    expected_modules = {
        f"v{migration.version:03d}_{migration.name}" for migration in WORKSPACE_MIGRATIONS
    }
    discovered_modules = {
        module.name
        for module in pkgutil.iter_modules(migration_package.__path__)
        if module.name.startswith("v")
    }
    assert discovered_modules == expected_modules

    for migration in WORKSPACE_MIGRATIONS:
        module_name = f"v{migration.version:03d}_{migration.name}"
        module = importlib.import_module(f"{migration_package.__name__}.{module_name}")
        migration_instances = [
            value for value in vars(module).values() if isinstance(value, Migration)
        ]
        assert migration_instances == [migration]


@pytest.mark.parametrize(
    "initializer,filename",
    [
        (initialize_global_database, "global.sqlite3"),
        (initialize_workspace_database, "workspace.sqlite3"),
    ],
)
def test_database_initialization_records_and_verifies_migration(
    tmp_path: Path, initializer, filename: str
) -> None:
    database = tmp_path / filename
    initializer(database)

    connection = connect(database)
    try:
        migration = connection.execute(
            "SELECT version, name, checksum FROM schema_migrations"
        ).fetchone()
        assert migration["version"] == 1
        assert migration["name"].startswith("initial_")
        assert len(migration["checksum"]) == 64
        connection.execute("UPDATE schema_migrations SET checksum = 'tampered'")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(RuntimeError, match="校验失败"):
        initializer(database)


def test_workspace_migration_is_safe_when_api_and_worker_start_together(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:3])
    barrier = threading.Barrier(4)

    def initialize() -> None:
        barrier.wait()
        initialize_workspace_database(database)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(initialize) for _ in range(4)]
        for future in futures:
            future.result()

    connection = connect(database)
    try:
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))


def test_recent_workspace_get_applies_missing_migrations(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    registry = WorkspaceRegistry(global_database)

    root = tmp_path / "dataset"
    root.mkdir()
    paths = WorkspacePaths.from_root(root, settings)
    paths.ensure_directories()
    manifest = WorkspaceManifest(
        project_id="recent-project",
        name="dataset",
        created_at=utc_now_iso(),
    )
    paths.manifest.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    migrate_database(paths.database, WORKSPACE_MIGRATIONS[:10])
    (root / "sample.txt").write_text("<caption>legacy</caption>", encoding="utf-8")
    connection = connect(paths.database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt',
                'valid', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        connection.commit()
    finally:
        connection.close()
    registry.upsert(manifest, root, utc_now_iso())

    WorkspaceService(settings, registry).get(manifest.project_id)

    connection = connect(paths.database)
    try:
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
        imported = connection.execute(
            """
            SELECT t.content, d.channel, d.reviewed_revision_id, d.head_revision_id
            FROM annotation_documents d
            JOIN annotation_text_contents t ON t.revision_id = d.head_revision_id
            WHERE d.asset_id = 'asset'
            """
        ).fetchone()
    finally:
        connection.close()
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
    assert imported is not None
    assert imported["content"] == "<caption>legacy</caption>"
    assert imported["channel"] == "existing_annotation"
    assert imported["reviewed_revision_id"] is None


def test_workspace_manifest_accepts_the_legacy_tag_context_setting_name() -> None:
    manifest = WorkspaceManifest.model_validate(
        {
            "project_id": "legacy-project",
            "name": "dataset",
            "created_at": "2026-01-01T00:00:00Z",
            "settings": {"use_confirmed_tags": True},
        }
    )

    assert manifest.settings.use_tags_as_context is True
    serialized_settings = manifest.model_dump()["settings"]
    assert serialized_settings["use_tags_as_context"] is True
    assert "use_confirmed_tags" not in serialized_settings


def test_recent_workspace_list_applies_missing_migrations_before_summary(
    tmp_path: Path,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    registry = WorkspaceRegistry(global_database)

    root = tmp_path / "dataset"
    root.mkdir()
    paths = WorkspacePaths.from_root(root, settings)
    paths.ensure_directories()
    manifest = WorkspaceManifest(
        project_id="recent-project",
        name="dataset",
        created_at=utc_now_iso(),
    )
    paths.manifest.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    migrate_database(paths.database, WORKSPACE_MIGRATIONS[:4])
    registry.upsert(manifest, root, utc_now_iso())

    summaries = WorkspaceService(settings, registry).list_recent()

    connection = connect(paths.database)
    try:
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()
    assert [summary.project_id for summary in summaries] == [manifest.project_id]
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
