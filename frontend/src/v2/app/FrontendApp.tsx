import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { useDesktopWindowBehavior } from "../../shared/desktop/useDesktopWindowBehavior";
import { FrontendErrorBoundary } from "./FrontendErrorBoundary";
import { FrontendRoutes } from "./FrontendRoutes";
import { createFrontendQueryClient } from "./queryClient";

export function FrontendApp() {
  useDesktopWindowBehavior();
  const [queryClient] = useState(createFrontendQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <FrontendErrorBoundary>
        <BrowserRouter>
          <FrontendRoutes />
        </BrowserRouter>
      </FrontendErrorBoundary>
    </QueryClientProvider>
  );
}
