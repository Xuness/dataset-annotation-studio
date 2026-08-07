export const FRONTEND_FIRST_USE_CHOICE_KEY = "dataset-studio.frontend.v2.first-use-choice.v1";
export const FRONTEND_FIRST_USE_DEFERRED_KEY = "dataset-studio.frontend.v2.first-use-deferred.v1";

export type FrontendFirstUseChoice = "continue" | "legacy";

export function shouldShowFrontendFirstUseDialog(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY) === null &&
      window.sessionStorage.getItem(FRONTEND_FIRST_USE_DEFERRED_KEY) === null
    );
  } catch {
    return true;
  }
}

export function rememberFrontendFirstUseChoice(choice: FrontendFirstUseChoice): void {
  try {
    window.localStorage.setItem(FRONTEND_FIRST_USE_CHOICE_KEY, choice);
    window.sessionStorage.removeItem(FRONTEND_FIRST_USE_DEFERRED_KEY);
  } catch {
    // The current visit can still dismiss the dialog when browser storage is unavailable.
  }
}

export function deferFrontendFirstUseForSession(): void {
  try {
    window.sessionStorage.setItem(FRONTEND_FIRST_USE_DEFERRED_KEY, "1");
  } catch {
    // Keep the in-memory dismissal for this mounted application.
  }
}
