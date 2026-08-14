import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { ExportSettingsPanel } from "../../pages/export/components/ExportSettingsPanel";
import type { ExportFormState } from "../../../src/application/exports/exportState";

afterEach(cleanup);

describe("export settings", () => {
  test("keeps independent revisions and applies custom directory rules", async () => {
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
        directoryLayout: {
          mode: "flat",
          merge_into_parent_paths: [],
        },
      });
      latest = form;
      return (
        <ExportSettingsPanel
          form={form}
          assetCount={2}
          candidateActive={false}
          checkedCount={0}
          folders={[
            {
              path: "",
              parent_path: null,
              name: "工作区根目录",
              direct_asset_count: 0,
              descendant_asset_count: 2,
            },
            {
              path: "characters",
              parent_path: "",
              name: "characters",
              direct_asset_count: 0,
              descendant_asset_count: 2,
            },
            {
              path: "characters/alice",
              parent_path: "characters",
              name: "alice",
              direct_asset_count: 2,
              descendant_asset_count: 2,
            },
          ]}
          foldersError={null}
          foldersPending={false}
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
    await user.click(screen.getByRole("button", { name: "自定义合并" }));
    expect(screen.getByText(/目录树仅统计当前项目中的 2 张图片/)).toBeTruthy();
    const directorySearch = screen.getByRole("textbox", { name: "搜索目录" });
    await user.type(directorySearch, "missing");
    expect(screen.getByText("没有匹配的目录。")).toBeTruthy();
    await user.clear(directorySearch);
    await user.type(directorySearch, "alice");
    await user.click(screen.getByRole("checkbox", { name: "将 characters/alice 并入父级" }));
    await user.click(screen.getByRole("button", { name: "应用规则" }));
    expect(latest?.directoryLayout).toEqual({
      mode: "custom",
      merge_into_parent_paths: ["characters/alice"],
    });
    expect(screen.getByText("已选择 1 个目录层级")).toBeTruthy();
    expect((screen.getByRole("button", { name: "校验并预览" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
