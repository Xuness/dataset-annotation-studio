import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { ExportSettingsPanel } from "../../src/pages/export/components/ExportSettingsPanel";
import type { ExportFormState } from "../../src/pages/export/types";

afterEach(cleanup);

describe("export channel settings", () => {
  test("keeps independent revisions for multiple translation languages", async () => {
    const user = userEvent.setup();
    let latest: ExportFormState | undefined;

    function Harness() {
      const [form, setForm] = useState<ExportFormState>({
        scope: "all",
        destinationPath: "D:\\export",
        selections: [
          {
            channel: "existing_annotation",
            language: "",
            revision: "current",
          },
        ],
        formats: ["txt"],
        packaging: "directory",
      });
      latest = form;
      return (
        <ExportSettingsPanel
          form={form}
          assetCount={2}
          checkedCount={0}
          preview={undefined}
          previewPending={false}
          exportPending={false}
          activeExport={false}
          error={null}
          onChange={(update) => setForm((current) => ({ ...current, ...update }))}
          onChooseFolder={() => undefined}
          onPreview={() => undefined}
          onExport={() => undefined}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "翻译" }));
    await user.click(screen.getByRole("button", { name: "添加另一种译文语言" }));

    const secondLanguage = screen.getByRole("textbox", { name: "译文语言 3" });
    await user.clear(secondLanguage);
    await user.type(secondLanguage, "fr");
    expect(document.activeElement).toBe(secondLanguage);
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: "翻译修订策略" })[0],
      "reviewed",
    );
    await user.click(screen.getByRole("button", { name: "ZIP 压缩包" }));
    expect(screen.getByText(/不会覆盖同名压缩包/)).toBeTruthy();

    expect(latest?.selections).toEqual([
      {
        channel: "existing_annotation",
        language: "",
        revision: "current",
      },
      {
        channel: "translation",
        language: "zh-CN",
        translation_source_kind: "description",
        translation_producer_kind: "llm",
        revision: "reviewed",
      },
      {
        channel: "translation",
        language: "fr",
        translation_source_kind: "description",
        translation_producer_kind: "llm",
        revision: "current",
      },
    ]);
    expect(latest?.packaging).toBe("zip");
    expect((screen.getByRole("button", { name: "校验并预览" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
