from dataset_studio.modules.annotations.models import AnnotationStatus
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance


def test_accepts_balanced_nested_and_self_closing_tags() -> None:
    result = validate_tag_balance(
        '<caption mood="quiet"><subject>girl & sky</subject><light /></caption>'
    )

    assert result.valid is True
    assert result.status == AnnotationStatus.VALID
    assert result.tag_count == 5


def test_rejects_mismatched_and_unclosed_tags() -> None:
    result = validate_tag_balance("<caption><subject>text</caption>")

    assert result.valid is False
    assert result.status == AnnotationStatus.INVALID
    assert {issue.code for issue in result.issues} == {
        "mismatched_closing_tag",
        "unclosed_tag",
    }


def test_does_not_validate_xml_entities() -> None:
    result = validate_tag_balance("<caption>one & two > three</caption>")

    assert result.valid is True


def test_empty_content_is_an_anomaly() -> None:
    result = validate_tag_balance("  \n")

    assert result.status == AnnotationStatus.EMPTY
