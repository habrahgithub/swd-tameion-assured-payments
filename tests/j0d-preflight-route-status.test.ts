import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runJ0dPreflight: vi.fn() }));

vi.mock("../src/j0d-spike/preflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/j0d-spike/preflight")>();
  return { ...actual, runJ0dPreflight: mocks.runJ0dPreflight };
});

import { POST } from "../app/api/j0d/preflight/route";

const resumeFrom = {
  walletSetId: "2b72f116-16da-591a-9212-5382388a35c4",
  sourceWallet: {
    id: "9fe9c001-a044-5f9a-8997-165474887952",
    address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95",
  },
  destinationWallet: {
    id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3",
    address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
  },
};

function request() {
  return new Request("http://localhost/api/j0d/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "READ_J0D_PREFLIGHT_ONLY", resumeFrom }),
  });
}

function blocked(blocker: string) {
  return {
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PREFLIGHT",
    readiness: "BLOCKED_EXTERNAL",
    blocker,
    message: "blocked",
    captured_at: "2026-09-29T06:10:00.000Z",
  };
}

beforeEach(() => mocks.runJ0dPreflight.mockReset());

describe("J0-D preflight route status semantics", () => {
  it.each([
    ["SOURCE_WALLET_CONTEXT_MISMATCH", 409],
    ["SOURCE_WALLET_NOT_LIVE", 409],
    ["INVALID_PROVIDER_TOKEN", 422],
    ["INVALID_PROVIDER_BALANCE", 422],
    ["INVALID_FEE_ESTIMATE", 422],
    ["PROVIDER_QUERY_FAILED", 502],
    ["FEE_ESTIMATE_FAILED", 502],
    ["CIRCLE_NOT_CONFIGURED", 503],
  ])("returns %s as HTTP %i", async (blocker, expectedStatus) => {
    mocks.runJ0dPreflight.mockResolvedValueOnce(blocked(blocker));
    const response = await POST(request());
    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body.result.blocker).toBe(blocker);
  });

  it("returns HTTP 200 for non-blocked read-only readiness", async () => {
    mocks.runJ0dPreflight.mockResolvedValueOnce({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PREFLIGHT",
      readiness: "FUNDING_REQUIRED",
      source_wallet: {},
      destination_wallet: {},
      source_usdc_balance: "0",
      source_usdc_token: null,
      minimum_transfer_amount: "0.01",
      estimated_network_fee: null,
      minimum_required_total: null,
      funding_address: resumeFrom.sourceWallet.address,
      captured_at: "2026-09-29T06:10:00.000Z",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
  });
});
