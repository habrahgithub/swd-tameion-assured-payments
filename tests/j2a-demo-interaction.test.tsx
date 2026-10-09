/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { CommandCenter } from "../app/command-center";

describe("retired fixed-ID Arc Testnet demo surface", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps sample playback and demo tools out of the initial obligation screen", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ obligations: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CommandCenter />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Demo tools")).toBeNull();
    expect(screen.queryByText("Read-only sample")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show sample playback" })).toBeNull();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET"]);
  });
});
