from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from dataset_studio.core.config import Settings
from dataset_studio.modules.tag_dictionaries.downloads.models import (
    TagDictionaryDownloadCreate,
    TagDictionaryDownloadOffer,
)
from dataset_studio.modules.tag_dictionaries.downloads.repository import (
    TagDictionaryDownloadRepository,
)
from dataset_studio.modules.tag_dictionaries.downloads.service import (
    TagDictionaryDownloadService,
)
from dataset_studio.modules.tag_dictionaries.downloads.worker import (
    TagDictionaryDownloadWorker,
)
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryDownloadMode,
    TagDictionaryLicenseStatus,
)
from dataset_studio.modules.tag_dictionaries.repository import TagDictionaryRepository
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    taggers = TaggerService(settings, TaggerRepository(database))
    dictionaries = TagDictionaryService(
        settings,
        TagDictionaryRepository(database),
        taggers,
    )
    downloads = TagDictionaryDownloadService(
        TagDictionaryDownloadRepository(database),
        dictionaries,
    )
    return dictionaries, downloads


def _offer(path: Path) -> TagDictionaryDownloadOffer:
    content = path.read_bytes()
    return TagDictionaryDownloadOffer(
        offer_id="test-tagcomplete",
        adapter_id="tagcomplete_cn",
        name="Test TagComplete",
        description="Test-only dictionary",
        source_id="tests/tagcomplete",
        source_url="https://github.com/tests/tagcomplete",
        source_version="test-revision",
        revision="a" * 40,
        download_mode=TagDictionaryDownloadMode.DIRECT,
        download_url="https://raw.githubusercontent.com/tests/tagcomplete/a/file.csv",
        filename="Tags-zh-full-pack.csv",
        download_size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        license_id="MIT",
        license_url="https://github.com/tests/tagcomplete/blob/a/LICENSE",
        license_status=TagDictionaryLicenseStatus.VERIFIED,
        license_notice="Test license notice.",
    )


class _LocalSource:
    def __init__(self, source: Path) -> None:
        self._source = source

    def materialize(self, offer, destination, *, on_progress, should_stop):
        assert not should_stop()
        destination.mkdir(parents=True, exist_ok=True)
        target = destination / offer.filename
        shutil.copyfile(self._source, target)
        on_progress(target.stat().st_size, offer.filename)
        return target


def test_dictionary_download_installs_and_resolves(tmp_path: Path) -> None:
    source = tmp_path / "source.csv"
    source.write_text("1girl,一个女孩\nsolo,单独\n", encoding="utf-8")
    dictionaries, downloads = _services(tmp_path)
    offer = _offer(source)
    downloads._offers = {offer.offer_id: offer}

    queued = downloads.create(
        TagDictionaryDownloadCreate(
            offer_id=offer.offer_id,
            license_accepted=True,
        )
    )
    row = downloads.repository.claim_next("test-worker")
    assert row is not None
    worker = TagDictionaryDownloadWorker(
        SimpleNamespace(
            tag_dictionaries=dictionaries,
            tag_dictionary_downloads=downloads,
        )
    )
    worker._source = _LocalSource(source)
    worker._process(row)

    completed = next(task for task in downloads.tasks() if task.id == queued.id)
    assert completed.status == "completed"
    assert completed.installation_id
    assert dictionaries.resolve(["1girl"], "zh-CN").entries[0].translation == "一个女孩"
    assert not (Path(completed.dictionary_root) / ".downloads" / completed.id).exists()


def test_manual_offer_cannot_enter_download_queue(tmp_path: Path) -> None:
    _, downloads = _services(tmp_path)

    with pytest.raises(ValueError, match="本地导入"):
        downloads.create(
            TagDictionaryDownloadCreate(
                offer_id="ffdkj-danbooru-zh-manual",
                license_accepted=True,
            )
        )


def test_dictionary_download_pause_resume_and_recovery(tmp_path: Path) -> None:
    source = tmp_path / "source.csv"
    source.write_text("solo,单独\n", encoding="utf-8")
    _, downloads = _services(tmp_path)
    offer = _offer(source)
    downloads._offers = {offer.offer_id: offer}
    task = downloads.create(
        TagDictionaryDownloadCreate(
            offer_id=offer.offer_id,
            license_accepted=True,
        )
    )

    paused = downloads.pause(task.id)
    assert paused.status == "paused"
    resumed = downloads.resume(task.id)
    assert resumed.status == "queued"
    claimed = downloads.repository.claim_next("orphaned-worker")
    assert claimed is not None
    assert downloads.repository.recover_orphaned() == 1
    interrupted = downloads.tasks()[0]
    assert interrupted.status == "interrupted"
    assert interrupted.can_resume is True
