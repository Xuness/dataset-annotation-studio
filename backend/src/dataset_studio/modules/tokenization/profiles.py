from __future__ import annotations

from dataset_studio.modules.tokenization.models import (
    TokenizationMetricDescriptor,
    TokenizationProfile,
    TokenizationProfileId,
)

QWEN3_VL_4B_METRIC_ID = "qwen3_vl_4b"
QWEN3_0_6B_METRIC_ID = "qwen3_0_6b"
T5_V1_1_XXL_METRIC_ID = "t5_v1_1_xxl"

KREA2_PREFIX = (
    "<|im_start|>system\n"
    "Describe the image by detailing the color, shape, size, texture, quantity, text, "
    "spatial relationships of the objects and background:<|im_end|>\n"
    "<|im_start|>user\n"
)
KREA2_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n"
KREA2_EXPECTED_PREFIX_TOKENS = 34
KREA2_EXPECTED_SUFFIX_TOKENS = 5

QWEN3_VL_4B_METRIC = TokenizationMetricDescriptor(
    id=QWEN3_VL_4B_METRIC_ID,
    label="Qwen3-VL-4B",
    short_label="Q3-VL",
)
QWEN3_0_6B_METRIC = TokenizationMetricDescriptor(
    id=QWEN3_0_6B_METRIC_ID,
    label="Qwen3-0.6B",
    short_label="Q3",
)
T5_V1_1_XXL_METRIC = TokenizationMetricDescriptor(
    id=T5_V1_1_XXL_METRIC_ID,
    label="T5 v1.1 XXL",
    short_label="T5",
)

TOKENIZATION_PROFILES: dict[TokenizationProfileId, TokenizationProfile] = {
    TokenizationProfileId.KREA2: TokenizationProfile(
        id=TokenizationProfileId.KREA2,
        name="Krea 2",
        description=(
            "使用 Qwen3-VL-4B，并按 Krea 2 训练模板计算有效文本编码长度："
            "包含 assistant 后缀，扣除固定的 system/user 前缀。"
        ),
        metrics=[QWEN3_VL_4B_METRIC],
    ),
    TokenizationProfileId.ANIMA: TokenizationProfile(
        id=TokenizationProfileId.ANIMA,
        name="Anima",
        description=(
            "同时计算 Anima 使用的 Qwen3-0.6B 与 T5 v1.1 XXL；"
            "Qwen 不额外添加特殊 Token，T5 包含一个 EOS。"
        ),
        metrics=[QWEN3_0_6B_METRIC, T5_V1_1_XXL_METRIC],
    ),
    TokenizationProfileId.T5: TokenizationProfile(
        id=TokenizationProfileId.T5,
        name="T5",
        description="使用 google/t5-v1_1-xxl Fast Tokenizer，并包含一个 EOS。",
        metrics=[T5_V1_1_XXL_METRIC],
    ),
}


def list_tokenization_profiles() -> list[TokenizationProfile]:
    return list(TOKENIZATION_PROFILES.values())
