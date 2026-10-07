import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { CharacterAuditServerInfo } from "./characterAuditServer";

export async function clickControl(testId: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>(testId).disabled).toBe(false), {
    timeout: 5000,
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

export async function exerciseCharacterAuditSteps(
  info: CharacterAuditServerInfo,
  navigation: { openTask: (id: string) => Promise<void>; showApply: () => Promise<void> },
): Promise<void> {
  await screen.findByTestId("character-start", {}, { timeout: 10_000 });
  await clickControl("character-start");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-stop").disabled).toBe(false),
  );
  await clickControl("character-stop");
  await screen.findByTestId("character-start");
  await clickControl("character-start");
  await screen.findByTestId("character-stop");
  await clickControl("character-stop");
  await screen.findByTestId("character-start");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-start").disabled).toBe(false),
  );
  await clickControl("character-new");
  await screen.findByTestId("character-trigger-0");
  fireEvent.change(screen.getByTestId("character-trigger-0"), { target: { value: "alpha" } });
  fireEvent.change(screen.getByTestId("character-minimum-count"), { target: { value: "1" } });
  await clickControl("character-add-profile");
  expect(screen.getByTestId("character-profile-1")).toBeTruthy();
  await clickControl("character-remove-1");
  expect(screen.queryByTestId("character-profile-1")).toBeNull();
  fireEvent.change(screen.getByTestId("character-reference-0"), {
    target: { value: info.reference_id },
  });
  fireEvent.change(screen.getByTestId("character-provider"), {
    target: { value: info.provider_id },
  });
  fireEvent.change(screen.getByTestId("character-model"), { target: { value: "audit-model" } });
  fireEvent.change(screen.getByTestId("character-vocabulary-directory"), {
    target: { value: info.source_directory },
  });
  fireEvent.change(screen.getByTestId("character-vocabulary-version"), {
    target: { value: "integration-fixture" },
  });
  await clickControl("character-license");
  await clickControl("character-import-vocabulary");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>("character-vocabulary").value).toBe(
      info.vocabulary_id,
    ),
  );
  await clickControl("character-preview-membership");
  await screen.findByTestId("character-membership-result");
  await clickControl("character-create");
  await screen.findByTestId("character-start");
  await navigation.openTask(info.review_id);
  await screen.findByTestId("character-decision-0");
  fireEvent.change(screen.getByTestId("character-reason-0"), {
    target: { value: "Manually checked the source evidence." },
  });
  await clickControl("character-save-review");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-save-review").disabled).toBe(false),
  );
  await clickControl("character-review-tab-1");
  await clickControl("character-save-review");
  await navigation.showApply();
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-generate-preview").disabled).toBe(
      false,
    ),
  );
  await clickControl("character-generate-preview");
  await screen.findByTestId("character-conflict-reason-0");
  expect(screen.getByTestId<HTMLButtonElement>("character-apply").disabled).toBe(true);
  for (let index = 0; index < 3; index += 1) {
    fireEvent.change(screen.getByTestId(`character-conflict-reason-${index}`), {
      target: { value: "The shared image retains this characteristic on another character." },
    });
    await clickControl(
      index === 0 ? "character-conflict-replace-0-0" : `character-conflict-keep-${index}`,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLButtonElement>(`character-conflict-keep-${index}`).disabled,
      ).toBe(false),
    );
  }
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-apply").disabled).toBe(false),
  );
}

export function exerciseCharacterAuditReview(info: CharacterAuditServerInfo): Promise<void> {
  return exerciseCharacterAuditSteps(info, {
    openTask: (id) => clickControl(`character-open-${id}`),
    showApply: () => Promise.resolve(),
  });
}
