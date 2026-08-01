import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { useState } from "react";

import { DialogHost } from "../../shared/ui/DialogHost";
import { confirmDialog } from "../../shared/ui/dialogs";
import { ModalLayer } from "../../shared/ui/ModalLayer";

afterEach(cleanup);

function NestedConfirmationHarness() {
  const [outcome, setOutcome] = useState("pending");
  const [outerOpen, setOuterOpen] = useState(true);

  return (
    <>
      <ModalLayer
        open={outerOpen}
        onClose={() => setOuterOpen(false)}
        backdropClassName="test-backdrop"
        panelClassName="test-panel"
        labelledBy="test-title"
        initialFocusSelector="[data-request-confirmation]"
      >
        <h1 id="test-title">外层设置面板</h1>
        <button
          type="button"
          data-request-confirmation=""
          onClick={() => {
            void confirmDialog("接受模型许可证？", {
              title: "许可证",
              confirmLabel: "接受",
            }).then((accepted) => setOutcome(accepted ? "accepted" : "rejected"));
          }}
        >
          请求确认
        </button>
      </ModalLayer>
      <DialogHost />
      <output aria-label="确认结果">{outcome}</output>
    </>
  );
}

test("a DOM modal can request confirmation without nesting native dialogs", async () => {
  const user = userEvent.setup();
  render(<NestedConfirmationHarness />);

  const requestButton = screen.getByRole("button", { name: "请求确认" });
  expect(document.querySelectorAll("dialog")).toHaveLength(0);

  await user.click(requestButton);

  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(screen.getByRole("alertdialog", { name: "许可证" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "接受" }));

  await waitFor(() => {
    expect(screen.getByRole("status", { name: "确认结果" }).textContent).toBe("accepted");
  });
  expect(document.querySelectorAll("dialog")).toHaveLength(0);
  expect(document.activeElement).toBe(requestButton);
});

test("the native confirmation receives Escape before its parent modal", async () => {
  const user = userEvent.setup();
  render(<NestedConfirmationHarness />);

  await user.click(screen.getByRole("button", { name: "请求确认" }));
  expect(screen.getByRole("alertdialog", { name: "许可证" })).toBeTruthy();
  await user.keyboard("{Escape}");

  await waitFor(() => {
    expect(screen.getByRole("status", { name: "确认结果" }).textContent).toBe("rejected");
  });
  expect(screen.getByRole("dialog", { name: "外层设置面板" })).toBeTruthy();
});
