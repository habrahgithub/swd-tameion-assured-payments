/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { LocalWalkthrough } from "../app/local-demo/walkthrough";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("offers receipt review and another case after reconciliation without another fake submission", async () => {
  window.history.replaceState({}, "", "/local-demo");
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("opener", null);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  render(<LocalWalkthrough />);
  await screen.findByRole("button", { name: "Assess mock case" });
  fireEvent.click(screen.getByRole("button", { name: "Assess mock case" }));
  fireEvent.click(await screen.findByRole("button", { name: "Acknowledge exact mock intent" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Submit to fake adapter" }) as HTMLButtonElement).disabled
    ).toBe(false)
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit to fake adapter" }));
  await screen.findByText("Fake submissions: 1", { exact: true });
  fireEvent.click(screen.getByRole("button", { name: "Observe recorded fake outcome" }));
  await waitFor(() =>
    expect(screen.getByTestId("journey-stage").textContent).toBe("RECONCILED_MOCK")
  );
  const strip = screen.getByRole("region", { name: "Current mock next action" });
  expect(strip.textContent).toContain("Complete");
  expect(within(strip).queryByRole("button", { name: /Next: Assess/ })).toBeNull();
  const receipt = within(strip).getByRole("button", { name: "Review receipt" });
  fireEvent.click(receipt);
  await waitFor(() =>
    expect(screen.getByTestId("mock-audit").contains(document.activeElement)).toBe(true)
  );
  expect(screen.getByTestId("mock-receipt-outcome").textContent).toContain("fake submissions: 1");
  fireEvent.click(within(strip).getByRole("button", { name: "Show actions" }));
  expect(
    receipt === document.activeElement ||
      within(strip).getByRole("button", { name: "Review receipt" }) === document.activeElement
  ).toBe(true);
  expect(screen.getByText("Fake submissions: 1", { exact: true })).toBeTruthy();
  fireEvent.click(within(strip).getByRole("button", { name: "Choose another mock case" }));
  await waitFor(() => expect(screen.getByTestId("journey-stage").textContent).toBe("OBLIGATION"));
});
