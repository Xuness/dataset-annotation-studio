import { useDesktopWindowBehavior } from "../../shared/desktop/useDesktopWindowBehavior";
import { HomeVariantHost } from "../pages/home/HomeVariantHost";
import { FrontendErrorBoundary } from "./FrontendErrorBoundary";

export function FrontendApp() {
  useDesktopWindowBehavior();
  return (
    <FrontendErrorBoundary>
      <HomeVariantHost />
    </FrontendErrorBoundary>
  );
}
