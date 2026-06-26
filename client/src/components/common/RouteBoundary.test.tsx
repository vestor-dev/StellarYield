import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteBoundary, RouteLoadingPanel } from "./RouteBoundary";

function Boom() {
  throw new Error("kaboom from child");
}

describe("RouteBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <RouteBoundary>
        <div>safe content</div>
      </RouteBoundary>,
    );
    expect(screen.queryByText("safe content")).not.toBeNull();
  });

  it("shows the error panel with the real message and does not swallow it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RouteBoundary>
        <Boom />
      </RouteBoundary>,
    );
    expect(screen.queryByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/kaboom from child/)).not.toBeNull();
    // The real error was logged, not silently discarded.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renders an accessible loading panel for the suspense fallback", () => {
    render(<RouteLoadingPanel />);
    expect(screen.queryByRole("status")).not.toBeNull();
  });
});
