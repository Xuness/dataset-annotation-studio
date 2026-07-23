from __future__ import annotations

import json
from functools import lru_cache

from dataset_studio.modules.jobs.models import JobKind
from dataset_studio.modules.output_resources import (
    annotation_output_resource_key,
    translation_output_relative_path,
)
from dataset_studio.modules.translations.languages import LANGUAGE_PATTERN


def job_output_resource_key(
    kind: str,
    configuration_snapshot: str,
    annotation_relative_path: str,
) -> str:
    job_kind, target_language = _job_output_configuration(kind, configuration_snapshot)
    output_path = annotation_relative_path
    if job_kind == JobKind.TRANSLATION:
        assert target_language is not None
        output_path = translation_output_relative_path(
            annotation_relative_path,
            target_language,
        )
    return annotation_output_resource_key(output_path)


@lru_cache(maxsize=128)
def _job_output_configuration(
    kind: str,
    configuration_snapshot: str,
) -> tuple[JobKind, str | None]:
    job_kind = JobKind(kind)
    if job_kind != JobKind.TRANSLATION:
        return job_kind, None
    try:
        configuration = json.loads(configuration_snapshot)
        language = str(configuration["target_language"])
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("翻译任务的配置快照无效。") from error
    if not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError("翻译任务的目标语言快照无效。")
    return job_kind, language
