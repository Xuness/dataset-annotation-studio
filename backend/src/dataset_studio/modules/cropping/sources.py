from pathlib import Path

from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.cropping.workbench_models import CropSource


def source_summaries(database: Path, asset_ids: list[str]) -> list[CropSource]:
    rows = AssetRepository(database).get_assets(asset_ids)
    result: list[CropSource] = []
    for asset_id in asset_ids:
        row = rows.get(asset_id)
        if row is None or not row["is_present"]:
            raise ValueError(f"裁剪源素材不存在或已移除：asset_id={asset_id}，请重新选择素材。")
        result.append(
            CropSource(
                id=asset_id,
                relative_path=str(row["relative_path"]),
                filename=str(row["filename"]),
                width=int(row["width"]),
                height=int(row["height"]),
                content_version=str(row["content_hash"]),
            )
        )
    return result
