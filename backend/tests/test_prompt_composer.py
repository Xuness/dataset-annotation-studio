from dataset_studio.modules.prompts.composer import (
    compose_user_prompt,
    preview_request_prompt,
    preview_user_prompt,
)


def test_appends_selected_json_fields_one_per_line() -> None:
    metadata = {
        "artist": "someone",
        "details": {"source": "archive", "ignored": 4},
        "characters": ["a", "b"],
    }

    result = compose_user_prompt(
        "Describe the image.",
        metadata,
        ["artist", "details.source", "characters", "missing"],
    )

    assert result == (
        'Describe the image.\n\nartist: someone\ndetails.source: archive\ncharacters: ["a","b"]'
    )


def test_preview_separates_metadata_lines() -> None:
    preview = preview_user_prompt("Task", {"key": "value"}, ["key"])

    assert preview.user_prompt == "Task"
    assert preview.metadata_lines == ["key: value"]
    assert preview.final_prompt == "Task\n\nkey: value"


def test_request_preview_keeps_system_and_final_user_messages_separate() -> None:
    preview = preview_request_prompt(
        system_preset_id="preset-1",
        system_preset_name="XML caption",
        system_prompt="Return balanced XML.",
        user_prompt="Describe the image.",
        metadata={"artist": "Mori"},
        selected_fields=["artist"],
    )

    assert preview.system_prompt == "Return balanced XML."
    assert preview.system_preset_name == "XML caption"
    assert preview.final_user_prompt == "Describe the image.\n\nartist: Mori"


def test_escaped_metadata_path_supports_dots_and_backslashes_in_keys() -> None:
    metadata = {
        "artist.name": {"source\\path": "value"},
        "artist": {"name": "different"},
    }

    result = compose_user_prompt(
        "Task",
        metadata,
        [r"artist\.name.source\\path", "artist.name"],
    )

    assert result == (
        "Task\n\n"
        r"artist\.name.source\\path: value"
        "\nartist.name: different"
    )


def test_legacy_unescaped_backslash_field_remains_compatible() -> None:
    result = compose_user_prompt("Task", {"source\\path": "legacy"}, [r"source\path"])

    assert result == "Task\n\nsource\\path: legacy"
