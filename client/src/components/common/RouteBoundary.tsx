import { Component, Suspense } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/load errors from a route subtree and shows a fallback panel
 * that surfaces the real error — it never swallows errors silently.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log the real error so monitoring/console still sees it.
    console.error("[RouteBoundary] render error:", error, info.componentStack);
  }

  private handleRetry = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          role="alert"
          className="m-6 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300"
        >
          <p className="font-semibold text-red-200">
            Something went wrong loading this page.
          </p>
          <p className="mt-1 break-words font-mono text-xs text-red-300/90">
            {error.message}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 rounded-lg bg-red-500/20 px-3 py-1.5 text-red-100 transition-colors hover:bg-red-500/30"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Loading fallback shown while a lazily-loaded route is resolving. */
export function RouteLoadingPanel() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex items-center justify-center gap-3 p-12 text-slate-400"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

/**
 * Route-level boundary: renders a loading panel while a lazy page loads, and an
 * error panel (surfacing the real error) if the page throws while loading or
 * rendering. Wrap analytics-heavy route elements with this.
 */
export function RouteBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoadingPanel />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default RouteBoundary;
