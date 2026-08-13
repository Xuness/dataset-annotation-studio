// Ordinary product startup uses the classic interface. An explicit V2 theme query keeps the
// new interface independently addressable from classic appearance settings and deep links.
import { shouldLoadNewFrontend } from "./v2/app/frontendEntry";

if (shouldLoadNewFrontend(window.location.search)) {
  void import("./frontend-main");
} else {
  void import("../Legacy/main");
}
