import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TranslationComparePanel } from "../../src/pages/workspace/components/TranslationComparePanel";
import type { TagDictionaryResolution, TranslationDocument } from "../../src/shared/api/types";

vi.mock("@uiw/react-codemirror", () => ({
  default: () => <textarea aria-label="译文编辑器" />,
}));

function translationDocument(update: Partial<TranslationDocument> = {}): TranslationDocument {
  return {
    asset_id: "asset-1",
    language: "zh-CN",
    source_kind: "description",
    producer_kind: "llm",
    resolved_source_channel: "description",
    path: "数据库 · translation:description:llm:zh-CN",
    exists: true,
    content: "<caption>安静, 花园!</caption>",
    source_content: "<caption>quiet, garden!</caption>",
    source_tags: [],
    status: "current",
    source_exists: true,
    source_hash: "source-hash",
    current_source_hash: "source-hash",
    source_revision_id: "source-revision",
    alignment_status: "aligned",
    alignment_parts: [
      {
        id: "structure-0",
        kind: "structure",
        source_text: "<caption>",
        translated_text: "<caption>",
        category: null,
        confidence: null,
      },
      {
        id: "segment-0",
        kind: "segment",
        source_text: "quiet",
        translated_text: "安静",
        category: null,
        confidence: null,
      },
      {
        id: "structure-1",
        kind: "structure",
        source_text: ",",
        translated_text: ",",
        category: null,
        confidence: null,
      },
      {
        id: "segment-1",
        kind: "segment",
        source_text: " garden",
        translated_text: " 花园",
        category: null,
        confidence: null,
      },
      {
        id: "structure-2",
        kind: "structure",
        source_text: "!",
        translated_text: "!",
        category: null,
        confidence: null,
      },
      {
        id: "structure-3",
        kind: "structure",
        source_text: "</caption>",
        translated_text: "</caption>",
        category: null,
        confidence: null,
      },
    ],
    validation_status: "valid",
    provider_profile_id: "provider",
    provider_profile_name: "Translator",
    model: "model",
    dictionary_resolution_hash: null,
    current_dictionary_resolution_hash: null,
    dictionary_sources: [],
    dictionary_override_count: 0,
    dictionary_unmatched_count: 0,
    modified_at: "translation-revision",
    updated_at: "2026-07-25T00:00:00Z",
    issue: null,
    ...update,
  };
}

function renderPanel(
  translation: TranslationDocument,
  dictionaryPreview?: TagDictionaryResolution,
) {
  return render(
    <TranslationComparePanel
      translation={translation}
      loading={false}
      error={null}
      editing={false}
      editContent=""
      editorExtensions={[]}
      onEditContentChange={() => undefined}
      dictionaryPreview={dictionaryPreview}
    />,
  );
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe("translation compare panel", () => {
  test("never renders an old translation when the source no longer matches", () => {
    renderPanel(
      translationDocument({
        status: "source_mismatch",
        content: "不应显示的旧译文",
        source_hash: "old-source-hash",
        current_source_hash: "new-source-hash",
        alignment_status: "unavailable",
        alignment_parts: [],
        issue: "当前不匹配：源标注已经变化，请重新翻译。",
      }),
    );

    expect(screen.getByRole("status").textContent).toContain("当前不匹配");
    expect(screen.getByText("<caption>quiet, garden!</caption>")).not.toBeNull();
    expect(screen.queryByText("不应显示的旧译文")).toBeNull();
    expect(screen.getByText(/旧译文没有在这里显示/)).not.toBeNull();
  });

  test("links a Tags pair while either side is hovered", () => {
    renderPanel(
      translationDocument({
        source_kind: "tags",
        resolved_source_channel: "tags",
        content: "蓝发\n爱丽丝",
        source_content: "blue_hair\nalice",
        source_tags: [
          {
            name: "blue_hair",
            category: "general",
            confidence: 0.98,
            origin: "tagger",
          },
          {
            name: "alice",
            category: "character",
            confidence: 0.91,
            origin: "tagger",
          },
        ],
        alignment_parts: [
          {
            id: "tag-0",
            kind: "tag",
            source_text: "blue_hair",
            translated_text: "蓝发",
            category: "general",
            confidence: 0.98,
          },
          {
            id: "tag-1",
            kind: "tag",
            source_text: "alice",
            translated_text: "爱丽丝",
            category: "character",
            confidence: 0.91,
          },
        ],
      }),
    );

    const source = screen.getByText("blue_hair");
    const translated = screen.getByText("蓝发");
    fireEvent.pointerEnter(translated);

    expect(source.closest(".tag-editor__chip")?.classList.contains("is-linked")).toBe(true);
    expect(translated.closest(".tag-editor__chip")?.classList.contains("is-linked")).toBe(true);

    fireEvent.pointerLeave(translated);
    expect(source.closest(".tag-editor__chip")?.classList.contains("is-linked")).toBe(false);
  });

  test("links the matching description segment across the two panes", () => {
    renderPanel(translationDocument());

    const source = screen.getByText("quiet");
    const translated = screen.getByText("安静");
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(source);

    expect(source.classList.contains("is-linked")).toBe(true);
    expect(translated.classList.contains("is-linked")).toBe(true);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-alignment-id="segment-1"]')).every(
        (element) => !element.classList.contains("is-linked"),
      ),
    ).toBe(true);
  });

  test("pins the matching Tags pair when text is selected on the translated side", () => {
    renderPanel(
      translationDocument({
        source_kind: "tags",
        resolved_source_channel: "tags",
        content: "蓝发\n爱丽丝",
        source_content: "blue_hair\nalice",
        alignment_parts: [
          {
            id: "tag-0",
            kind: "tag",
            source_text: "blue_hair",
            translated_text: "蓝发",
            category: "general",
            confidence: 0.98,
          },
          {
            id: "tag-1",
            kind: "tag",
            source_text: "alice",
            translated_text: "爱丽丝",
            category: "character",
            confidence: 0.91,
          },
        ],
      }),
    );

    const source = screen.getByText("alice");
    const translated = screen.getByText("爱丽丝");
    const range = document.createRange();
    range.selectNodeContents(translated);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(translated);

    expect(source.closest(".tag-editor__chip")?.classList.contains("is-linked")).toBe(true);
    expect(translated.closest(".tag-editor__chip")?.classList.contains("is-linked")).toBe(true);
    expect(
      screen.getByText("blue_hair").closest(".tag-editor__chip")?.classList.contains("is-linked"),
    ).toBe(false);
  });

  test("groups a live local-dictionary preview by the source Tag categories", () => {
    const sourceTags = [
      {
        name: "blue_hair",
        category: "general",
        confidence: 0.98,
        origin: "tagger",
      },
      {
        name: "alice",
        category: "character",
        confidence: 0.91,
        origin: "tagger",
      },
      {
        name: "wonderland",
        category: "copyright",
        confidence: null,
        origin: "manual",
      },
    ];
    renderPanel(
      translationDocument({
        source_kind: "tags",
        producer_kind: "local_dictionary",
        resolved_source_channel: "tags",
        source_tags: sourceTags,
        source_content: sourceTags.map((tag) => tag.name).join("\n"),
        content: "不应显示的旧译文",
        status: "source_mismatch",
        alignment_status: "unavailable",
        alignment_parts: [],
      }),
      {
        language: "zh-CN",
        entries: [
          {
            requested_tag: "blue_hair",
            normalized_tag: "blue_hair",
            translation: "蓝发",
            matched: true,
            source_kind: "dictionary",
            installation_id: "dictionary-1",
            installation_name: "Danbooru 中英表",
            adapter_id: "ffdkj",
            source_version: "2026-07-25",
            category: "general",
            post_count: 100,
            override_revision: null,
          },
          {
            requested_tag: "alice",
            normalized_tag: "alice",
            translation: "爱丽丝",
            matched: true,
            source_kind: "override",
            installation_id: null,
            installation_name: null,
            adapter_id: null,
            source_version: null,
            category: "character",
            post_count: null,
            override_revision: 1,
          },
          {
            requested_tag: "wonderland",
            normalized_tag: "wonderland",
            translation: null,
            matched: false,
            source_kind: "fallback",
            installation_id: null,
            installation_name: null,
            adapter_id: null,
            source_version: null,
            category: null,
            post_count: null,
            override_revision: null,
          },
        ],
        resolution_hash: "a".repeat(64),
        unmatched_count: 1,
      },
    );

    const panes = document.querySelectorAll(".translation-compare__tag-groups");
    expect(panes.length).toBe(2);
    for (const pane of panes) {
      expect(
        Array.from(pane.querySelectorAll(".translation-compare__tag-group > header strong")).map(
          (heading) => heading.textContent,
        ),
      ).toEqual(["角色", "作品", "通用"]);
    }
    expect(screen.getByText("爱丽丝")).not.toBeNull();
    expect(screen.getAllByText("wonderland").length).toBe(2);
    expect(screen.getByText("未命中")).not.toBeNull();
    expect(screen.queryByText("不应显示的旧译文")).toBeNull();
  });
});
