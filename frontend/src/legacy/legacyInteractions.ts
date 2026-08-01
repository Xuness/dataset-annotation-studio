import type { AlertInteraction, ConfirmInteraction } from "../application/interaction";
import { alertDialog, confirmDialog } from "../shared/ui/dialogs";

export const legacyConfirm: ConfirmInteraction = ({ message, ...options }) =>
  confirmDialog(message, options);

export const legacyAlert: AlertInteraction = ({ message, title }) =>
  alertDialog(message, { title });
