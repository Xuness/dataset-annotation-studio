from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.provider_snapshot import load_provider_snapshot
from dataset_studio.modules.prompts.composer import compose_user_prompt
from dataset_studio.modules.providers.reasoning import extract_reasoning_from_raw
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.service import WorkspaceService


class TraceRequestParameters(BaseModel):
    execution_backend: str = "provider"
    provider_type: str
    provider_profile_name: str
    model: str
    temperature: float | None = None
    max_output_tokens: int | None = None
    timeout_seconds: int | None = None
    top_p: float | None = None
    seed: int | None = None
    service_tier: str | None = None
    reasoning_effort: str | None = None
    prompt_cache_strategy: str | None = None
    adapter_id: str | None = None
    installation_id: str | None = None
    model_version: str | None = None
    threshold: float | None = None
    categories: list[str] | None = None
    device: str | None = None
    batch_size: int | None = None


class TraceRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    source: Literal["recorded", "reconstructed"]
    parameters: TraceRequestParameters


class TraceResponse(BaseModel):
    reasoning_content: str | None = None
    final_content: str | None = None
    error_message: str | None = None
    finish_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None


class AssetAnnotationTrace(BaseModel):
    job_id: str
    job_status: str
    item_id: str
    item_status: str
    attempt_id: str
    attempt_number: int
    attempt_status: str
    started_at: str
    finished_at: str | None = None
    annotation_exists: bool
    annotation_source: str | None = None
    matches_current_annotation: bool
    request: TraceRequest
    response: TraceResponse


class AnnotationTraceService:
    """Projects one asset's current annotation back to the attempt that produced it."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        assets: AssetService,
        annotations: AnnotationService,
    ) -> None:
        self._workspaces = workspaces
        self._assets = assets
        self._annotations = annotations

    def get(self, project_id: str, asset_id: str) -> AssetAnnotationTrace | None:
        paths, _ = self._workspaces.get(project_id)
        annotation = self._annotations.get(project_id, asset_id)
        metadata = self._assets.metadata(project_id, asset_id)
        rows = self._attempt_rows(paths.database, asset_id)
        if not rows:
            return None

        annotation_source = (
            self._annotation_source(
                paths.database,
                asset_id,
                annotation.content,
            )
            if annotation.exists
            else None
        )
        candidates = [
            self._build_trace(
                paths,
                row,
                annotation_exists=annotation.exists,
                annotation_content=annotation.content,
                annotation_source=annotation_source,
                metadata=metadata.value if metadata.exists and not metadata.error else None,
            )
            for row in rows
        ]
        if annotation.exists:
            matching = next(
                (candidate for candidate in candidates if candidate.matches_current_annotation),
                None,
            )
            if matching is not None:
                return matching
        return candidates[0]

    @staticmethod
    def _attempt_rows(database_path: Path, asset_id: str) -> list[dict[str, object]]:
        connection = connect(database_path)
        try:
            rows = connection.execute(
                """
                SELECT
                    j.id AS job_id,
                    j.status AS job_status,
                    j.system_prompt_snapshot,
                    j.user_prompt_snapshot,
                    j.json_fields_snapshot,
                    j.provider_snapshot,
                    j.execution_backend,
                    j.execution_snapshot,
                    ji.id AS item_id,
                    ji.status AS item_status,
                    ji.asset_id,
                    ja.id AS attempt_id,
                    ja.attempt_number,
                    ja.status AS attempt_status,
                    ja.response_content,
                    ja.error_message,
                    ja.provider_payload_path,
                    ja.started_at,
                    ja.finished_at,
                    ja.input_tokens,
                    ja.output_tokens,
                    ja.cache_read_tokens,
                    ja.cache_write_tokens,
                    ja.reasoning_tokens,
                    ja.finish_reason
                FROM job_attempts ja
                JOIN job_items ji ON ji.id = ja.job_item_id
                JOIN jobs j ON j.id = ji.job_id
                WHERE ji.asset_id = ? AND j.kind = 'annotation'
                ORDER BY ja.started_at DESC, ja.rowid DESC
                LIMIT 100
                """,
                (asset_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            connection.close()

    @staticmethod
    def _annotation_source(
        database_path: Path,
        asset_id: str,
        content: str,
    ) -> str | None:
        connection = connect(database_path)
        try:
            row = connection.execute(
                """
                SELECT source
                FROM annotation_revisions
                WHERE asset_id = ? AND content = ?
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (asset_id, content),
            ).fetchone()
            return str(row["source"]) if row is not None else "external"
        finally:
            connection.close()

    def _build_trace(
        self,
        paths: WorkspacePaths,
        row: dict[str, object],
        *,
        annotation_exists: bool,
        annotation_content: str,
        annotation_source: str | None,
        metadata: object,
    ) -> AssetAnnotationTrace:
        artifact = self._load_artifact(paths, row)
        execution_backend = _string(row.get("execution_backend")) or "provider"
        snapshot = _json_object(
            row.get("execution_snapshot")
            if execution_backend == "local_tagger"
            else row.get("provider_snapshot")
        )
        request_payload = artifact.get("request")
        recorded_request = request_payload if isinstance(request_payload, dict) else None

        parameters = _request_parameters(execution_backend, snapshot)
        if recorded_request is not None:
            recorded_parameters = recorded_request.get("parameters")
            if isinstance(recorded_parameters, dict):
                parameters.update(recorded_parameters)
            system_prompt = _string(recorded_request.get("system_prompt")) or ""
            user_prompt = _string(recorded_request.get("user_prompt")) or ""
            request_source: Literal["recorded", "reconstructed"] = "recorded"
        else:
            system_snapshot = _json_object(row.get("system_prompt_snapshot"))
            system_prompt = _string(system_snapshot.get("system_prompt")) or ""
            selected_fields = _json_list(row.get("json_fields_snapshot"))
            user_prompt = compose_user_prompt(
                _string(row.get("user_prompt_snapshot")) or "",
                metadata,
                [str(field) for field in selected_fields],
            )
            request_source = "reconstructed"

        final_content = _string(artifact.get("content"))
        attempt_status = _string(row.get("attempt_status")) or "unknown"
        if final_content is None and attempt_status not in {"request_failed", "internal_error"}:
            final_content = _string(row.get("response_content"))

        raw = artifact.get("raw")
        reasoning_content = _string(artifact.get("reasoning_content"))
        if reasoning_content is None:
            reasoning_content = extract_reasoning_from_raw(raw)

        response = TraceResponse(
            reasoning_content=reasoning_content,
            final_content=final_content,
            error_message=_string(artifact.get("error")) or _string(row.get("error_message")),
            finish_reason=_string(artifact.get("finish_reason"))
            or _string(row.get("finish_reason")),
            input_tokens=_first_integer(
                artifact.get("input_tokens"),
                row.get("input_tokens"),
            ),
            output_tokens=_first_integer(
                artifact.get("output_tokens"),
                row.get("output_tokens"),
            ),
            cache_read_tokens=_first_integer(
                artifact.get("cache_read_tokens"),
                row.get("cache_read_tokens"),
            ),
            cache_write_tokens=_first_integer(
                artifact.get("cache_write_tokens"),
                row.get("cache_write_tokens"),
            ),
            reasoning_tokens=_first_integer(
                artifact.get("reasoning_tokens"),
                row.get("reasoning_tokens"),
            ),
        )
        return AssetAnnotationTrace(
            job_id=str(row["job_id"]),
            job_status=str(row["job_status"]),
            item_id=str(row["item_id"]),
            item_status=str(row["item_status"]),
            attempt_id=str(row["attempt_id"]),
            attempt_number=int(row["attempt_number"]),
            attempt_status=attempt_status,
            started_at=str(row["started_at"]),
            finished_at=_string(row.get("finished_at")),
            annotation_exists=annotation_exists,
            annotation_source=annotation_source,
            matches_current_annotation=(
                annotation_exists
                and final_content is not None
                and final_content == annotation_content
            ),
            request=TraceRequest(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                source=request_source,
                parameters=TraceRequestParameters.model_validate(parameters),
            ),
            response=response,
        )

    @staticmethod
    def _load_artifact(
        paths: WorkspacePaths,
        row: dict[str, object],
    ) -> dict[str, object]:
        candidates: list[Path] = []
        relative_path = _string(row.get("provider_payload_path"))
        if relative_path:
            candidates.append(paths.root / relative_path)
        attempt_number = int(row["attempt_number"])
        attempt_root = paths.runs / str(row["job_id"]) / str(row.get("asset_id", ""))
        candidates.extend(
            (
                attempt_root / f"attempt-{attempt_number}.json",
                attempt_root / f"attempt-{attempt_number}-error.json",
            )
        )
        root = paths.root.resolve()
        for candidate in candidates:
            resolved = candidate.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_file():
                continue
            try:
                payload = json.loads(resolved.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                return payload
        return {}


def _request_parameters(
    execution_backend: str,
    snapshot: dict[str, object],
) -> dict[str, object]:
    if execution_backend == "local_tagger":
        try:
            profile = TaggerExecutionProfile.model_validate(snapshot)
        except (TypeError, ValueError):
            return {
                "execution_backend": "local_tagger",
                "provider_type": "local_tagger",
                "provider_profile_name": _string(snapshot.get("name")) or "本地打标配置",
                "model": _string(snapshot.get("installation_name")) or "unknown",
                "adapter_id": _string(snapshot.get("adapter_id")),
                "installation_id": _string(snapshot.get("installation_id")),
                "model_version": _string(snapshot.get("model_version")),
                "threshold": _number(snapshot.get("threshold")),
                "categories": _string_list(snapshot.get("categories")),
                "device": _string(snapshot.get("device")),
                "batch_size": _integer(snapshot.get("batch_size")),
            }
        return {
            "execution_backend": "local_tagger",
            "provider_type": "local_tagger",
            "provider_profile_name": profile.name,
            "model": profile.model_label,
            "adapter_id": profile.adapter_id,
            "installation_id": profile.installation_id,
            "model_version": profile.model_version,
            "threshold": profile.threshold,
            "categories": profile.categories,
            "device": profile.device.value,
            "batch_size": profile.batch_size,
        }
    try:
        profile = load_provider_snapshot(snapshot)
    except (KeyError, TypeError, ValueError):
        return {
            "execution_backend": "provider",
            "provider_type": _string(snapshot.get("provider_type")) or "unknown",
            "provider_profile_name": _string(snapshot.get("name")) or "未命名 API 配置",
            "model": _string(snapshot.get("model")) or "unknown",
            "temperature": _number(snapshot.get("temperature")),
            "max_output_tokens": _integer(snapshot.get("max_output_tokens")),
            "timeout_seconds": _integer(snapshot.get("timeout_seconds")),
            "top_p": None,
            "seed": None,
            "service_tier": None,
            "reasoning_effort": None,
            "prompt_cache_strategy": None,
        }
    model = profile.model
    options = model.protocol_options
    return {
        "execution_backend": "provider",
        "provider_type": profile.provider_type.value,
        "provider_profile_name": profile.name,
        "model": model.model_id,
        "temperature": model.temperature,
        "max_output_tokens": model.max_output_tokens,
        "timeout_seconds": model.timeout_seconds,
        "top_p": model.top_p,
        "seed": model.seed,
        "service_tier": _enum_value(getattr(options, "service_tier", None)),
        "reasoning_effort": _enum_value(getattr(options, "reasoning_effort", None)),
        "prompt_cache_strategy": _enum_value(getattr(options, "prompt_cache_strategy", None)),
    }


def _json_object(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if not isinstance(value, str):
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _string_list(value: object) -> list[str] | None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    return [str(item) for item in value]


def _enum_value(value: object) -> str | None:
    if value is None:
        return None
    return str(getattr(value, "value", value))


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _integer(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_integer(*values: object) -> int | None:
    for value in values:
        parsed = _integer(value)
        if parsed is not None:
            return parsed
    return None
