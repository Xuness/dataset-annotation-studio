from pathlib import Path

import pytest

from dataset_studio.modules.providers.media import image_mime_type
from dataset_studio.modules.providers.models import ProviderRequestError
from dataset_studio.modules.providers.openai_compatible import _parse_response


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("sample.jpg", "image/jpeg"),
        ("sample.JPEG", "image/jpeg"),
        ("sample.png", "image/png"),
        ("sample.webp", "image/webp"),
        ("sample.bmp", "image/bmp"),
        ("sample.tif", "image/tiff"),
        ("sample.TIFF", "image/tiff"),
    ],
)
def test_image_mime_type_is_stable_across_platforms(filename: str, expected: str) -> None:
    assert image_mime_type(Path(filename)) == expected


def test_openai_compatible_surfaces_error_from_success_status_payload() -> None:
    response_text = (
        '{"error":{"message":"Unsupported MIME type: application/octet-stream","code":400}}'
    )

    with pytest.raises(ProviderRequestError) as captured:
        _parse_response(
            {
                "error": {
                    "message": "Unsupported MIME type: application/octet-stream",
                    "code": 400,
                }
            },
            response_text,
        )

    assert str(captured.value) == ("API 返回错误：Unsupported MIME type: application/octet-stream")
    assert captured.value.status_code == 400
    assert captured.value.response_text == response_text


def test_openai_compatible_parses_standard_response() -> None:
    response = _parse_response(
        {
            "choices": [
                {
                    "message": {"content": "<caption>VRchat</caption>"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 5},
        },
        "unused",
    )

    assert response.content == "<caption>VRchat</caption>"
    assert response.finish_reason == "stop"
    assert response.input_tokens == 12
    assert response.output_tokens == 5
