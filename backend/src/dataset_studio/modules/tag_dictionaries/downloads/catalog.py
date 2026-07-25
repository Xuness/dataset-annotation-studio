from __future__ import annotations

from dataset_studio.modules.tag_dictionaries.downloads.models import (
    TagDictionaryDownloadOffer,
)
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryDownloadMode,
    TagDictionaryLicenseStatus,
)

_OFFERS = (
    TagDictionaryDownloadOffer(
        offer_id="weilin-prompt-b7b2911",
        adapter_id="weilin_prompt",
        name="WeiLin Prompt 数据库",
        description="WeiLin-Comfyui-Tools 的 Tag 与 Danbooru 数据库快照。",
        source_id="weilin9999/WeiLin-Comfyui-Tools-Prompt",
        source_url="https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt",
        source_version="2025_04_01",
        revision="b7b2911a2794cc04ebf9e091ce17b1547fb1d2ec",
        download_mode=TagDictionaryDownloadMode.DIRECT,
        download_url=(
            "https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt/"
            "archive/b7b2911a2794cc04ebf9e091ce17b1547fb1d2ec.zip"
        ),
        filename="weilin-prompt-b7b2911.zip",
        download_size=1_606_048,
        sha256="a64b3afac62ba9f5494a5e4b12c97d2347c5e6d27ece90efe8e43fccbd6721ce",
        license_id="MIT",
        license_url=(
            "https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt/"
            "blob/b7b2911a2794cc04ebf9e091ce17b1547fb1d2ec/LICENSE"
        ),
        license_status=TagDictionaryLicenseStatus.VERIFIED,
        license_notice=(
            "该词典直接从 WeiLin Prompt 上游固定 commit 下载，仓库声明为 MIT。"
            "Dataset Studio 不拥有其中的词条内容。"
        ),
    ),
    TagDictionaryDownloadOffer(
        offer_id="tagcomplete-cn-78ed786",
        adapter_id="tagcomplete_cn",
        name="TagComplete 中文整合包",
        description="常用 Danbooru Tag 的简体中文社区整合翻译。",
        source_id="byzod/a1111-sd-webui-tagcomplete-CN",
        source_url="https://github.com/byzod/a1111-sd-webui-tagcomplete-CN",
        source_version="78ed786",
        revision="78ed7862b8cb22df58efad19b5bd4bcf8160d7c7",
        download_mode=TagDictionaryDownloadMode.DIRECT,
        download_url=(
            "https://raw.githubusercontent.com/byzod/"
            "a1111-sd-webui-tagcomplete-CN/"
            "78ed7862b8cb22df58efad19b5bd4bcf8160d7c7/"
            "tags/Tags-zh-full-pack.csv"
        ),
        filename="Tags-zh-full-pack.csv",
        download_size=310_347,
        sha256="424ae67f5a0823e5e7f90d9f49ee721a53ef6cba16a207636a095e70f0955b24",
        license_id="MIT（内容来源混合）",
        license_url=(
            "https://github.com/byzod/a1111-sd-webui-tagcomplete-CN/"
            "blob/78ed7862b8cb22df58efad19b5bd4bcf8160d7c7/LICENSE"
        ),
        license_status=TagDictionaryLicenseStatus.MIXED,
        license_notice=(
            "仓库包含 LICENSE，但 README 说明翻译整合自多个社区来源。"
            "请阅读来源说明后自行判断使用范围。"
        ),
    ),
    TagDictionaryDownloadOffer(
        offer_id="ffdkj-danbooru-zh-manual",
        adapter_id="ffdkj_danbooru_zh",
        name="ffdkj Danbooru 中英表",
        description="覆盖面较大的每日更新 tag.sqlite；当前未声明明确许可证。",
        source_id="ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table",
        source_url=(
            "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
        ),
        source_version="rolling",
        download_mode=TagDictionaryDownloadMode.MANUAL,
        license_id="未声明",
        license_url=(
            "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
        ),
        license_status=TagDictionaryLicenseStatus.UNDECLARED,
        license_notice=("上游当前没有明确 LICENSE；应用只提供来源页和本地导入，不主动下载。"),
    ),
    TagDictionaryDownloadOffer(
        offer_id="licyk-zh-manual",
        adapter_id="licyk_zh",
        name="licyk 中英 CSV",
        description="兼容 TagComplete 的两列中英 CSV；来源与授权尚不明确。",
        source_id="licyk/tag_pp_zh_new.csv",
        source_url="https://licyk.github.io/resources/tag_pp_zh_new.csv",
        source_version="rolling",
        download_mode=TagDictionaryDownloadMode.MANUAL,
        license_id="未声明",
        license_url="https://github.com/licyk/licyk.github.io",
        license_status=TagDictionaryLicenseStatus.UNDECLARED,
        license_notice=("词典文件没有可确认的许可证与生成说明；应用只支持本地导入。"),
    ),
)


def dictionary_download_offers() -> tuple[TagDictionaryDownloadOffer, ...]:
    return tuple(offer.model_copy(deep=True) for offer in _OFFERS)
