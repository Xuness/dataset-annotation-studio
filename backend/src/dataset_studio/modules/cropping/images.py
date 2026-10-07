import math
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, PngImagePlugin, UnidentifiedImageError

from dataset_studio.modules.cropping.models import CropRect

SUPPORTED_MODES = frozenset({"1", "L", "LA", "P", "RGB", "RGBA"})


def inspect_image(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            if getattr(image, "n_frames", 1) != 1:
                raise ValueError(f"裁剪仅支持静态图片，多帧输入无法处理：{path}")
            if image.mode not in SUPPORTED_MODES:
                raise ValueError(f"不支持可靠 PNG 裁剪的颜色模式：path={path}，mode={image.mode}")
            if image.format == "PNG":
                with path.open("rb") as source:
                    header = source.read(25)
                if len(header) == 25 and header[24] > 8:
                    raise ValueError(
                        f"PNG 原始位深超过可靠裁剪支持范围：path={path}，bits={header[24]}"
                    )
            if image.format == "TIFF":
                bits = image.getexif().get(258)
                samples = (
                    bits if isinstance(bits, tuple) else (bits,) if isinstance(bits, int) else ()
                )
                if any(not isinstance(sample, int) or sample > 8 for sample in samples):
                    raise ValueError(f"TIFF 原始位深超过可靠裁剪支持范围：path={path}，bits={bits}")
            image.load()
            if not image.info.get("icc_profile"):
                color_chunks(image)
            return ImageOps.exif_transpose(image).size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError(f"源图片不能可靠解码：path={path}，原因={error}") from error


def color_chunks(image: Image.Image) -> PngImagePlugin.PngInfo:
    chunks = PngImagePlugin.PngInfo()
    gamma = image.info.get("gamma")
    if gamma is not None:
        if not isinstance(gamma, (int, float)) or not math.isfinite(gamma) or gamma <= 0:
            raise ValueError(f"PNG gamma 信息无效：{gamma}")
        chunks.add(b"gAMA", struct.pack(">I", round(gamma * 100_000)), False)
    intent = image.info.get("srgb")
    if intent is not None:
        if not isinstance(intent, int) or not 0 <= intent <= 3:
            raise ValueError(f"PNG sRGB 渲染意图无效：{intent}")
        chunks.add(b"sRGB", bytes([intent]), False)
    chromaticity = image.info.get("chromaticity")
    if chromaticity is not None:
        if not isinstance(chromaticity, tuple) or len(chromaticity) != 8:
            raise ValueError("PNG chromaticity 信息必须包含八个坐标。")
        values: list[int] = []
        for coordinate in chromaticity:
            if (
                not isinstance(coordinate, (float, int))
                or not math.isfinite(coordinate)
                or not 0 <= coordinate <= 1
            ):
                raise ValueError(f"PNG chromaticity 坐标无效：{coordinate}")
            values.append(round(coordinate * 100_000))
        chunks.add(b"cHRM", struct.pack(">8I", *values), False)
    return chunks


def render_png(source: Path, rect: CropRect, maximum_edge: int | None) -> bytes:
    inspect_image(source)
    with Image.open(source) as image:
        oriented = ImageOps.exif_transpose(image)
        cropped = oriented.crop((rect.x, rect.y, rect.x + rect.width, rect.y + rect.height))
        # Materialize color-key transparency before resizing or removing metadata.
        if cropped.mode in {"1", "L", "P", "RGB"} and "transparency" in cropped.info:
            cropped = cropped.convert("LA" if cropped.mode in {"1", "L"} else "RGBA")
        elif cropped.mode == "P":
            cropped = cropped.convert("RGB")
        if maximum_edge is not None:
            cropped.thumbnail((maximum_edge, maximum_edge), Image.Resampling.LANCZOS)
        output = BytesIO()
        # Preserve usable color information, never stale orientation or EXIF metadata.
        icc = image.info.get("icc_profile")
        cropped.info.clear()
        if icc:
            cropped.save(output, format="PNG", icc_profile=icc)
        else:
            cropped.save(output, format="PNG", pnginfo=color_chunks(image))
        return output.getvalue()
