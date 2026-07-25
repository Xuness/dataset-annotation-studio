from __future__ import annotations

import json
from functools import lru_cache

from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.jobs.models import JobKind
from dataset_studio.modules.output_resources import annotation_document_resource_key


def job_output_resource_key(
    kind: str,
    configuration_snapshot: str,
    asset_id: str,
    output_channel: str,
) -> str:
    (
        job_kind,
        target_language,
        translation_source_kind,
        translation_producer_kind,
    ) = _job_output_configuration(kind, configuration_snapshot)
    if job_kind == JobKind.TRANSLATION and output_channel != "translation":
        raise ValueError("翻译任务的输出通道快照无效。")
    if job_kind == JobKind.ANNOTATION and output_channel == "translation":
        raise ValueError("标注任务的输出通道快照无效。")
    return annotation_document_resource_key(
        asset_id,
        output_channel,
        target_language or "",
        translation_source_kind or "",
        translation_producer_kind or "",
    )


@lru_cache(maxsize=128)
def _job_output_configuration(
    kind: str,
    configuration_snapshot: str,
) -> tuple[JobKind, str | None, str | None, str | None]:
    job_kind = JobKind(kind)
    if job_kind != JobKind.TRANSLATION:
        return job_kind, None, None, None
    try:
        configuration = json.loads(configuration_snapshot)
        language = normalize_language_code(str(configuration["target_language"]))
        source_kind = str(configuration.get("translation_source_kind", "description"))
        producer_kind = str(configuration.get("translation_producer_kind", "llm"))
        if source_kind not in {"description", "tags"}:
            raise ValueError("翻译任务的来源快照无效。")
        if producer_kind not in {"llm", "local_dictionary"}:
            raise ValueError("翻译任务的生产器快照无效。")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("翻译任务的配置快照无效。") from error
    return job_kind, language, source_kind, producer_kind
