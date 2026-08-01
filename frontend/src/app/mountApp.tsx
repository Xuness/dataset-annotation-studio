import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import { AppErrorBoundary } from "./AppErrorBoundary";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function mountApp(app: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error('Application root element "#root" was not found.');
  }

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={createAppQueryClient()}>
        <AppErrorBoundary>
          <HashRouter>{app}</HashRouter>
        </AppErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}
