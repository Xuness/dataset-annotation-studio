export interface ConfirmationRequest {
  message: string;
  title?: string;
  tone?: "default" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AlertRequest {
  message: string;
  title?: string;
}

export type ConfirmInteraction = (request: ConfirmationRequest) => Promise<boolean>;
export type AlertInteraction = (request: AlertRequest) => Promise<void>;

export function actionError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
