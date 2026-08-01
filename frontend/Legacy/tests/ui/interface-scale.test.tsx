import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { InterfaceScaleControl } from "../../shared/ui/InterfaceScaleControl";

afterEach(cleanup);

test("interface scale starts at and resets to the project default", async () => {
  const user = userEvent.setup();
  render(<InterfaceScaleControl />);

  expect(screen.getByTitle("当前界面缩放比例").textContent).toBe("120%");
  expect(
    (screen.getByRole("button", { name: "恢复默认界面缩放" }) as HTMLButtonElement).disabled,
  ).toBe(true);

  await user.click(screen.getByRole("button", { name: "缩小界面" }));
  expect(screen.getByTitle("当前界面缩放比例").textContent).toBe("110%");

  await user.click(screen.getByRole("button", { name: "恢复默认界面缩放" }));
  expect(screen.getByTitle("当前界面缩放比例").textContent).toBe("120%");
});
