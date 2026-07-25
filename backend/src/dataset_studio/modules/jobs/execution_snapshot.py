from __future__ import annotations

from dataset_studio.modules.jobs.models import ExecutionBackend
from dataset_studio.modules.jobs.provider_snapshot import load_provider_snapshot
from dataset_studio.modules.providers.config import ProviderExecutionProfile
from dataset_studio.modules.tag_dictionaries.models import TagDictionaryExecutionProfile
from dataset_studio.modules.taggers.models import TaggerExecutionProfile

ExecutionProfile = ProviderExecutionProfile | TaggerExecutionProfile | TagDictionaryExecutionProfile


def load_execution_snapshot(
    backend: str | ExecutionBackend,
    value: str | dict[str, object] | None,
    *,
    legacy_provider_snapshot: str | dict[str, object] | None = None,
) -> ExecutionProfile:
    execution_backend = ExecutionBackend(str(backend))
    snapshot = legacy_provider_snapshot if value is None or value == "" else value
    if snapshot is None:
        raise ValueError("任务缺少执行配置快照。")
    if execution_backend == ExecutionBackend.LOCAL_TAGGER:
        if isinstance(snapshot, str):
            return TaggerExecutionProfile.model_validate_json(snapshot)
        return TaggerExecutionProfile.model_validate(snapshot)
    if execution_backend == ExecutionBackend.LOCAL_DICTIONARY:
        if isinstance(snapshot, str):
            return TagDictionaryExecutionProfile.model_validate_json(snapshot)
        return TagDictionaryExecutionProfile.model_validate(snapshot)
    return load_provider_snapshot(snapshot)
