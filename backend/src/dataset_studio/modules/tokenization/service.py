from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from importlib.resources import as_file, files
from threading import Lock
from typing import Any

from tokenizers import Tokenizer

from dataset_studio.modules.tokenization.models import (
    TokenCountRequest,
    TokenCountResponse,
    TokenCountResult,
    TokenizationProfile,
    TokenizationProfileId,
    TokenMetricCount,
)
from dataset_studio.modules.tokenization.profiles import (
    KREA2_EXPECTED_PREFIX_TOKENS,
    KREA2_EXPECTED_SUFFIX_TOKENS,
    KREA2_PREFIX,
    KREA2_SUFFIX,
    QWEN3_0_6B_METRIC_ID,
    QWEN3_VL_4B_METRIC_ID,
    T5_V1_1_XXL_METRIC_ID,
    TOKENIZATION_PROFILES,
    list_tokenization_profiles,
)

_RESOURCE_PACKAGE = "dataset_studio.modules.tokenization.resources"
_HASH_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True, slots=True)
class _TokenizerAsset:
    id: str
    filename: str
    sha256: str


class BuiltinTokenizerService:
    """Loads the committed tokenizer assets lazily and counts without network access."""

    def __init__(self) -> None:
        self._assets = self._load_manifest()
        self._tokenizers: dict[str, Tokenizer] = {}
        self._lock = Lock()

    def list_profiles(self) -> list[TokenizationProfile]:
        return list_tokenization_profiles()

    def count(self, request: TokenCountRequest) -> TokenCountResponse:
        profile = TOKENIZATION_PROFILES[request.profile_id]
        results = [
            TokenCountResult(
                id=item.id,
                metrics=self._count_item(request.profile_id, item.text),
            )
            for item in request.items
        ]
        return TokenCountResponse(profile=profile, items=results)

    def _count_item(
        self,
        profile_id: TokenizationProfileId,
        text: str,
    ) -> list[TokenMetricCount]:
        if profile_id is TokenizationProfileId.KREA2:
            return [
                TokenMetricCount(
                    metric_id=QWEN3_VL_4B_METRIC_ID,
                    count=self._count_krea2(text),
                )
            ]
        if profile_id is TokenizationProfileId.ANIMA:
            return [
                TokenMetricCount(
                    metric_id=QWEN3_0_6B_METRIC_ID,
                    count=self._count_plain_qwen3(text),
                ),
                TokenMetricCount(
                    metric_id=T5_V1_1_XXL_METRIC_ID,
                    count=self._count_t5(text),
                ),
            ]
        if profile_id is TokenizationProfileId.T5:
            return [
                TokenMetricCount(
                    metric_id=T5_V1_1_XXL_METRIC_ID,
                    count=self._count_t5(text),
                )
            ]
        raise ValueError(f"不支持的 Tokenizer 预设：{profile_id}")

    def _count_krea2(self, text: str) -> int:
        tokenizer = self._get_tokenizer(QWEN3_VL_4B_METRIC_ID)
        prefix_count = len(tokenizer.encode(KREA2_PREFIX, add_special_tokens=False).ids)
        suffix_count = len(tokenizer.encode(KREA2_SUFFIX, add_special_tokens=False).ids)
        if (
            prefix_count != KREA2_EXPECTED_PREFIX_TOKENS
            or suffix_count != KREA2_EXPECTED_SUFFIX_TOKENS
        ):
            raise RuntimeError(
                "内置 Qwen3-VL-4B Tokenizer 与 Krea 2 模板不匹配："
                f"prefix={prefix_count}, suffix={suffix_count}"
            )
        prompt_count = len(tokenizer.encode(f"{KREA2_PREFIX}{text}", add_special_tokens=False).ids)
        return prompt_count - prefix_count + suffix_count

    def _count_plain_qwen3(self, text: str) -> int:
        tokenizer = self._get_tokenizer(QWEN3_0_6B_METRIC_ID)
        return len(tokenizer.encode(text, add_special_tokens=False).ids)

    def _count_t5(self, text: str) -> int:
        tokenizer = self._get_tokenizer(T5_V1_1_XXL_METRIC_ID)
        return len(tokenizer.encode(text, add_special_tokens=True).ids)

    def _get_tokenizer(self, asset_id: str) -> Tokenizer:
        cached = self._tokenizers.get(asset_id)
        if cached is not None:
            return cached
        with self._lock:
            cached = self._tokenizers.get(asset_id)
            if cached is not None:
                return cached
            asset = self._assets.get(asset_id)
            if asset is None:
                raise RuntimeError(f"内置 Tokenizer 清单缺少资源：{asset_id}")
            resource = files(_RESOURCE_PACKAGE).joinpath(asset.filename)
            digest = hashlib.sha256()
            with resource.open("rb") as handle:
                while chunk := handle.read(_HASH_CHUNK_SIZE):
                    digest.update(chunk)
            actual_sha256 = digest.hexdigest()
            if actual_sha256 != asset.sha256:
                raise RuntimeError(
                    f"内置 Tokenizer 校验失败：{asset.filename}，"
                    f"expected={asset.sha256}, actual={actual_sha256}"
                )
            with as_file(resource) as resource_path:
                tokenizer = Tokenizer.from_file(str(resource_path))
            tokenizer.no_padding()
            tokenizer.no_truncation()
            self._tokenizers[asset_id] = tokenizer
            return tokenizer

    @staticmethod
    def _load_manifest() -> dict[str, _TokenizerAsset]:
        manifest_resource = files(_RESOURCE_PACKAGE).joinpath("manifest.json")
        with manifest_resource.open("r", encoding="utf-8") as handle:
            manifest: dict[str, Any] = json.load(handle)
        if manifest.get("schema_version") != 1:
            raise RuntimeError("不支持的内置 Tokenizer 清单版本。")
        assets: dict[str, _TokenizerAsset] = {}
        for raw_asset in manifest.get("assets", []):
            asset = _TokenizerAsset(
                id=str(raw_asset["id"]),
                filename=str(raw_asset["filename"]),
                sha256=str(raw_asset["sha256"]).lower(),
            )
            if asset.id in assets:
                raise RuntimeError(f"内置 Tokenizer 清单包含重复资源：{asset.id}")
            assets[asset.id] = asset
        return assets
