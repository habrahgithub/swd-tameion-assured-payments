/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { CommandCenter } from "../app/command-center";

describe("retired fixed-ID Arc Testnet demo surface", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps operator playback API-free and removes the independent synthetic payment lane", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ obligations: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CommandCenter />);
    const demos = screen.getByText("Demo tools");
    fireEvent.click(demos);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(within(demos.closest("details")!).queryByText("Arc Testnet")).toBeNull();
    expect(within(demos.closest("details")!).getByText("Read-only sample")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET"]);
  });
});
