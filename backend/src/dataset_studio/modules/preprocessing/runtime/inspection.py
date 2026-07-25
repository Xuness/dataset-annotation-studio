from __future__ import annotations

from pathlib import Path

from PIL import Image

from dataset_studio.modules.preprocessing.runtime.contracts import ImageDescriptor


def inspect_image(path: Path) -> ImageDescriptor:
    with Image.open(path) as image:
        mode = image.mode
        codec = (image.format or path.suffix.removeprefix(".")).lower()
        has_alpha = mode in {"LA", "La", "PA", "RGBA", "RGBa"} or "transparency" in image.info
        if mode == "1":
            bit_depth = 1
        elif mode.startswith("I;16"):
            bit_depth = 16
        elif mode in {"I", "F"}:
            bit_depth = 32
        else:
            bit_depth = 8
        try:
            orientation = int(image.getexif().get(274, 1))
        except (AttributeError, TypeError, ValueError):
            orientation = 1
        return ImageDescriptor(
            codec=codec,
            mode=mode,
            bit_depth=bit_depth,
            has_alpha=has_alpha,
            is_animated=getattr(image, "n_frames", 1) > 1,
            exif_orientation=orientation,
            is_progressive=bool(
                image.info.get("progressive", False) or image.info.get("progression", False)
            ),
        )
