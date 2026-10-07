from math import floor

from dataset_studio.modules.cropping.models import CropRect, Ratio


def centered_rectangle(width: int, height: int, ratio: Ratio) -> CropRect:
    factor = ratio.width / ratio.height
    if width / height > factor:
        crop_height = height
        crop_width = max(1, min(width, floor(height * factor + 0.5)))
    else:
        crop_width = width
        crop_height = max(1, min(height, floor(width / factor + 0.5)))
    rect = CropRect(
        x=(width - crop_width) // 2,
        y=(height - crop_height) // 2,
        width=crop_width,
        height=crop_height,
        ratio=ratio,
    )
    validate_rectangle(rect, width, height)
    return rect


def validate_rectangle(rect: CropRect, width: int, height: int) -> None:
    if rect.x + rect.width > width or rect.y + rect.height > height:
        raise ValueError(f"裁剪框越界：框={rect.model_dump()}，原图={width}×{height}。")
    if rect.ratio is not None:
        factor = rect.ratio.width / rect.ratio.height
        deviation = min(
            abs(rect.width - rect.height * factor), abs(rect.height - rect.width / factor)
        )
        if deviation >= 1:
            raise ValueError(
                f"裁剪框不符合锁定比例：尺寸={rect.width}×{rect.height}，"
                f"比例={rect.ratio.width}:{rect.ratio.height}，偏差={deviation}像素。"
            )
