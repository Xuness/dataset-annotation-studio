import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { useWorkspaceLayout } from "../../src/pages/workspace/hooks/useWorkspaceLayout";

const STORAGE_PREFIX = "dataset-studio.workspace-layout";

function LayoutProbe({ projectId }: { projectId: string }) {
  const { layout, setLayout } = useWorkspaceLayout(projectId);

  return (
    <div>
      <output aria-label="当前布局">
        {layout.assetPaneWidth}/{layout.inspectorPaneWidth}/{layout.imagePaneRatio}
      </output>
      <button
        type="button"
        onClick={() => setLayout((current) => ({ ...current, assetPaneWidth: 333 }))}
      >
        调整素材栏
      </button>
    </div>
  );
}

describe("project workspace layout", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  test("switches project-scoped layouts without persisting the previous project into the next", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      `${STORAGE_PREFIX}.project-a`,
      JSON.stringify({ assetPaneWidth: 260, inspectorPaneWidth: 300, imagePaneRatio: 58 }),
    );
    window.localStorage.setItem(
      `${STORAGE_PREFIX}.project-b`,
      JSON.stringify({ assetPaneWidth: 410, inspectorPaneWidth: 360, imagePaneRatio: 72 }),
    );

    const view = render(<LayoutProbe projectId="project-a" />);
    expect(screen.getByRole("status", { name: "当前布局" }).textContent).toBe("260/300/58");

    await user.click(screen.getByRole("button", { name: "调整素材栏" }));
    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}.project-a`) ?? "null")
          .assetPaneWidth,
      ).toBe(333);
    });

    view.rerender(<LayoutProbe projectId="project-b" />);

    expect(screen.getByRole("status", { name: "当前布局" }).textContent).toBe("410/360/72");
    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}.project-b`) ?? "null"),
      ).toEqual({ assetPaneWidth: 410, inspectorPaneWidth: 360, imagePaneRatio: 72 });
    });
  });
});
