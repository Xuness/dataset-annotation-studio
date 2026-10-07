from contextlib import closing
from pathlib import Path

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    initialize_workspace_database,
)
from dataset_studio.platform.global_store import GLOBAL_MIGRATIONS, initialize_global_database


def test_upgrades_the_published_external_workspace_schema_without_rewriting_it(
    tmp_path: Path,
) -> None:
    assert WORKSPACE_MIGRATIONS[21].checksum == (
        "757f7cbf741e7683165e656943ba36ff837a63185bc4fd66bd003955e9ac64b9"
    )
    assert GLOBAL_MIGRATIONS[16].checksum == (
        "81607daa88e6b01bcf79c5ee77f234f20abcfe9eaf7dd5639dd627829c667e5f"
    )
    workspace = tmp_path / "workspace.sqlite3"
    global_database = tmp_path / "global.sqlite3"
    migrate_database(workspace, WORKSPACE_MIGRATIONS[:22])
    migrate_database(global_database, GLOBAL_MIGRATIONS[:17])
    with transaction(global_database) as connection:
        connection.execute(
            "INSERT INTO workspace_locations(project_id,root_path,root_path_key,storage_version) "
            "VALUES ('existing-project','D:/dataset','d:/dataset',1)"
        )
    for database, initializer, count, expected_tables in (
        (
            workspace,
            initialize_workspace_database,
            22,
            {"original_files", "character_audits", "crop_outputs"},
        ),
        (
            global_database,
            initialize_global_database,
            17,
            {"workspace_locations", "crop_ratio_presets"},
        ),
    ):
        with closing(connect(database)) as connection:
            before = list(connection.execute("SELECT * FROM schema_migrations ORDER BY version"))
        initializer(database)
        with closing(connect(database)) as connection:
            after = list(
                connection.execute(
                    "SELECT * FROM schema_migrations WHERE version<=? ORDER BY version", (count,)
                )
            )
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        assert [tuple(row) for row in before] == [tuple(row) for row in after]
        assert expected_tables <= tables
    with closing(connect(global_database)) as connection:
        assert tuple(
            connection.execute(
                "SELECT root_path,storage_version FROM workspace_locations "
                "WHERE project_id='existing-project'"
            ).fetchone()
        ) == ("D:/dataset", 1)
