from dataset_studio.modules.prompts.composer import compose_user_prompt, preview_user_prompt


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
