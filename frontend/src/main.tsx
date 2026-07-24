import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { initializeRuntimePlatform } from "./shared/desktop/runtimePlatform";
import { initializeAppPreferences } from "./shared/theme/appPreferences";
import "./styles/global.css";

initializeRuntimePlatform();
initializeAppPreferences();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
