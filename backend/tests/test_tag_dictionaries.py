from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

import pytest

from dataset_studio.core.config import Settings
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryImportRequest,
    TagDictionaryInstallationUpdate,
    TagDictionaryOrderUpdate,
    TagDictionaryOverrideUpsert,
)
from dataset_studio.modules.tag_dictionaries.repository import TagDictionaryRepository
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.models import TaggerSettingsUpdate
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.platform.global_store import initialize_global_database


def _service(tmp_path: Path) -> TagDictionaryService:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    taggers = TaggerService(settings, TaggerRepository(database))
    return TagDictionaryService(
        settings,
        TagDictionaryRepository(database),
        taggers,
    )


def test_dictionary_root_is_sibling_of_source_model_directory(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    taggers = TaggerService(settings, TaggerRepository(database))
    model_root = tmp_path / "source" / "models" / "taggers"
    taggers.update_settings(TaggerSettingsUpdate(model_root=str(model_root)))

    service = TagDictionaryService(
        settings,
        TagDictionaryRepository(database),
        taggers,
    )

    assert service.dictionary_root() == (tmp_path / "source" / "dictionaries").resolve()


def test_source_checkout_root_takes_precedence_for_dictionary_storage(tmp_path: Path) -> None:
    source_root = tmp_path / "checkout"
    settings = Settings(
        app_data_dir=tmp_path / "app-data",
        host="127.0.0.1",
        port=0,
        source_root=source_root,
    )
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    taggers = TaggerService(settings, TaggerRepository(database))

    service = TagDictionaryService(
        settings,
        TagDictionaryRepository(database),
        taggers,
    )

    assert service.dictionary_root() == (source_root / "dictionaries").resolve()


def test_resolve_trims_tag_boundaries_and_falls_back_to_builtin_rating_terms(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)

    resolved = service.resolve(
        [" general\r\n", "sensitive", "questionable", "explicit\n", "general"],
        "zh-CN",
        categories=[" Rating ", "rating", "rating", "rating", "general"],
    )

    assert [entry.requested_tag for entry in resolved.entries] == [
        "general",
        "sensitive",
        "questionable",
        "explicit",
        "general",
    ]
    assert [entry.translation for entry in resolved.entries] == [
        "一般",
        "敏感",
        "可疑",
        "露骨",
        None,
    ]
    assert [entry.installation_id for entry in resolved.entries[:4]] == [
        "builtin:tagger-ratings"
    ] * 4
    assert resolved.entries[-1].source_kind == "fallback"
    assert resolved.unmatched_count == 1


def test_managed_dictionary_and_override_take_priority_over_builtin_rating_terms(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    dictionary = tmp_path / "Tags-zh-full-pack.csv"
    dictionary.write_text("explicit,限制内容\n", encoding="utf-8")
    service.import_local(TagDictionaryImportRequest(path=str(dictionary)))

    managed = service.resolve(["explicit"], "zh-CN", categories=["rating"]).entries[0]
    assert managed.translation == "限制内容"
    assert managed.installation_id != "builtin:tagger-ratings"

    service.upsert_override(TagDictionaryOverrideUpsert(tag="explicit", translation="自定义分级"))
    overridden = service.resolve(["explicit"], "zh-CN", categories=["rating"]).entries[0]
    assert overridden.translation == "自定义分级"
    assert overridden.source_kind == "override"


def test_import_resolve_reorder_override_and_delete(tmp_path: Path) -> None:
    service = _service(tmp_path)
    tagcomplete = tmp_path / "Tags-zh-full-pack.csv"
    tagcomplete.write_text(
        "1girl,一个女孩\nsolo,单独\nlong_hair,长发\n",
        encoding="utf-8",
    )
    fallback = tmp_path / "tag_pp_zh_new.csv"
    fallback.write_text(
        "1girl,一名女孩\nblue_eyes,蓝眼睛\n",
        encoding="utf-8",
    )

    first = service.import_local(TagDictionaryImportRequest(path=str(tagcomplete)))
    second = service.import_local(TagDictionaryImportRequest(path=str(fallback)))

    assert first.dictionary_root == str((tmp_path / "app-data" / "dictionaries").resolve())
    assert len(second.installations) == 2
    resolved = service.resolve(["1girl", "blue_eyes", "unknown_tag"], "zh-CN")
    assert [entry.translation for entry in resolved.entries] == [
        "一个女孩",
        "蓝眼睛",
        None,
    ]
    assert resolved.unmatched_count == 1

    ordered_ids = [item.id for item in reversed(second.installations)]
    service.reorder(TagDictionaryOrderUpdate(installation_ids=ordered_ids))
    reordered = service.resolve(["1girl"], "zh-CN")
    assert reordered.entries[0].translation == "一名女孩"

    override = service.upsert_override(
        TagDictionaryOverrideUpsert(tag="1girl", translation="单个女孩")
    )
    assert override.revision == 1
    corrected = service.resolve(["1girl"], "zh-CN")
    assert corrected.entries[0].translation == "单个女孩"
    assert corrected.entries[0].source_kind == "override"
    updated_override = service.upsert_override(
        TagDictionaryOverrideUpsert(tag="1girl", translation="一个女孩子")
    )
    assert updated_override.revision == 2

    removed = service.delete_installation(ordered_ids[0])
    assert len(removed.installations) == 1
    assert removed.override_count == 1
    assert service.resolve(["1girl"], "zh-CN").entries[0].translation == "一个女孩子"

    service.delete_override("1girl", "zh-CN")
    assert service.resolve(["1girl"], "zh-CN").entries[0].translation == "一个女孩"


def test_ffdkj_sqlite_and_weilin_sql_import(tmp_path: Path) -> None:
    service = _service(tmp_path)
    ffdkj = tmp_path / "tag.sqlite"
    connection = sqlite3.connect(ffdkj)
    try:
        connection.execute(
            """
            CREATE TABLE tag (
                name TEXT PRIMARY KEY,
                category INTEGER,
                cn_name TEXT,
                post_count INTEGER
            )
            """
        )
        connection.execute("INSERT INTO tag VALUES ('hakurei_reimu', 4, '博丽灵梦', 100000)")
        connection.commit()
    finally:
        connection.close()

    library = service.import_local(TagDictionaryImportRequest(path=str(ffdkj)))
    assert library.installations[0].adapter_id == "ffdkj_danbooru_zh"
    reimu = service.resolve(["hakurei_reimu"], "zh-CN").entries[0]
    assert reimu.translation == "博丽灵梦"
    assert reimu.category == "character"
    assert reimu.post_count == 100000

    weilin = tmp_path / "WeiLin" / "danbooru" / "2025_04_01"
    weilin.mkdir(parents=True)
    (weilin / "danbooru_2025_04_01_001.sql").write_text(
        "\n".join(
            [
                'INSERT OR REPLACE INTO  "danbooru_tag" '
                '("id_index", "tag", "color_id", "translate", "hot", "aliases") '
                "VALUES (1, '1girl', 0, '一个女孩', 5975112, 1);",
                'INSERT OR REPLACE INTO  "danbooru_tag" '
                '("id_index", "tag", "color_id", "translate", "hot", "aliases") '
                "VALUES (2, 'artist''s_name', 1, '画师''名称', 50, 'alias_one|alias_two');",
            ]
        ),
        encoding="utf-8",
    )
    library = service.import_local(TagDictionaryImportRequest(path=str(tmp_path / "WeiLin")))
    weilin_installation = next(
        item for item in library.installations if item.adapter_id == "weilin_prompt"
    )
    assert weilin_installation.source_version == "2025_04_01"
    artist = service.resolve(["artist's_name"], "zh-CN").entries[0]
    assert artist.translation == "画师'名称"
    assert artist.category == "artist"


def test_weilin_zip_can_be_imported_from_the_local_file_picker(tmp_path: Path) -> None:
    service = _service(tmp_path)
    archive = tmp_path / "weilin.zip"
    sql = (
        'INSERT OR REPLACE INTO "danbooru_tag" '
        '("id_index", "tag", "color_id", "translate", "hot", "aliases") '
        "VALUES (1, 'blue_hair', 0, '蓝发', 100, NULL);"
    )
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr(
            "WeiLin-Comfyui-Tools-Prompt/danbooru/2025_04_01/danbooru_2025_04_01_001.sql",
            sql,
        )

    library = service.import_local(TagDictionaryImportRequest(path=str(archive)))

    assert library.installations[0].adapter_id == "weilin_prompt"
    assert library.installations[0].source_version == "2025_04_01"
    assert service.resolve(["blue_hair"], "zh-CN").entries[0].translation == "蓝发"


def test_disable_dictionary_falls_back_without_removing_installation(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = tmp_path / "tag_pp_zh_new.csv"
    source.write_text("solo,单独\n", encoding="utf-8")
    library = service.import_local(TagDictionaryImportRequest(path=str(source)))
    installation = library.installations[0]

    updated = service.update_installation(
        installation.id,
        TagDictionaryInstallationUpdate(enabled=False),
    )

    assert updated.enabled is False
    entry = service.resolve(["solo"], "zh-CN").entries[0]
    assert entry.matched is False
    assert entry.source_kind == "fallback"


def test_invalid_installation_is_excluded_from_library_totals_and_job_profile(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    source = tmp_path / "Tags-zh-full-pack.csv"
    source.write_text("solo,单独\n", encoding="utf-8")
    library = service.import_local(TagDictionaryImportRequest(path=str(source)))
    installation = library.installations[0]
    (Path(installation.path) / "dictionary.sqlite3").unlink()

    current = service.library()
    profile = service.execution_profile("zh-CN")

    assert current.installations[0].status == "invalid"
    assert current.entry_count == 0
    assert profile.sources == []


def test_execution_profile_counts_only_overrides_for_requested_language(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    service.upsert_override(
        TagDictionaryOverrideUpsert(
            tag="solo",
            translation="ソロ",
            language="ja",
        )
    )

    assert service.execution_profile("zh-CN").override_count == 0
    assert service.execution_profile("ja").override_count == 1


def test_search_treats_sql_wildcards_as_literal_text(tmp_path: Path) -> None:
    service = _service(tmp_path)
    for tag in ("rate%tag", "ratextag"):
        service.upsert_override(TagDictionaryOverrideUpsert(tag=tag, translation=f"译文 {tag}"))

    result = service.search("%", "zh-CN", offset=0, limit=20)

    assert [item.tag for item in result.items] == ["rate%tag"]


def test_tag_inputs_reject_embedded_line_breaks(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = tmp_path / "Tags-zh-full-pack.csv"
    source.write_text('"two\nlines",译文\n', encoding="utf-8")

    with pytest.raises(ValueError, match="不能包含换行"):
        service.import_local(TagDictionaryImportRequest(path=str(source)))
    with pytest.raises(ValueError, match="不能包含换行"):
        TagDictionaryOverrideUpsert(tag="two\nlines", translation="译文")
