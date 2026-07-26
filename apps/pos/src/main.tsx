import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./index.css";

declare global {
  interface Window {
    __POS_PWA_LICENSE__?: Promise<boolean>;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — cache data to survive brief offline periods
      retry: 2,
    },
  },
});

void (window.__POS_PWA_LICENSE__ ?? Promise.resolve(false)).then((allowed) => {
  if (!allowed) return;
  registerSW({ immediate: true });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
