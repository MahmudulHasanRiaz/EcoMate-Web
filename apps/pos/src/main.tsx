// POS entry
import { Component, StrictMode } from "react";
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

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 p-8 text-center">
          <div>
            <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
            <pre className="mt-4 max-w-xl overflow-auto rounded-xl bg-slate-900 p-4 text-left text-sm text-slate-400">
              {err.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 rounded-xl bg-emerald-500 px-6 py-3 font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
            >
              Reload POS
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
