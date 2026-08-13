export const FRONTEND_FIRST_USE_CHOICE_KEY = "dataset-studio.frontend.v2.first-use-choice.v1";
export const FRONTEND_FIRST_USE_SEEN_KEY = "dataset-studio.frontend.v2.first-use-seen.v1";

export type FrontendFirstUseChoice = "continue" | "legacy";

export function shouldShowFrontendFirstUseDialog(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY) === null &&
      window.localStorage.getItem(FRONTEND_FIRST_USE_SEEN_KEY) === null
    );
  } catch {
    return true;
  }
}

export function rememberFrontendFirstUseSeen(): void {
  try {
    window.localStorage.setItem(FRONTEND_FIRST_USE_SEEN_KEY, "1");
  } catch {
    // The dialog can still be dismissed for this mounted application without storage.
  }
}

export function rememberFrontendFirstUseChoice(choice: FrontendFirstUseChoice): void {
  try {
    window.localStorage.setItem(FRONTEND_FIRST_USE_SEEN_KEY, "1");
    window.localStorage.setItem(FRONTEND_FIRST_USE_CHOICE_KEY, choice);
  } catch {
    // The current visit can still dismiss the dialog when browser storage is unavailable.
  }
}
