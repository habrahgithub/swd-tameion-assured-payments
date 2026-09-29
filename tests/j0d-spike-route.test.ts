import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

import { POST } from "../app/api/j0d/run-connectivity-spike/route";
import { computeJ0dIntentFingerprint, type J0dExactIntent } from "../src/j0d-spike/intent";

const resumeFrom = {
  walletSetId: "2b72f116-16da-591a-9212-5382388a35c4",
  sourceWallet: { id: "9fe9c001-a044-5f9a-8997-165474887952", address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95" },
  destinationWallet: { id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3", address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9" },
};
const approvedIntent: J0dExactIntent = {
  intent_version: "J0D-EXACT-INTENT-v2",
  classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION",
  network: "ARC-TESTNET",
  asset: "USDC",
  amount: "0.01",
  fee_level: "MEDIUM",
  estimated_network_fee: "0.001000000000000000",
  minimum_required_total: "0.011000000000000000",
  max_network_fee: "0.002",
  max_total_debit: "0.012",
  wallet_set_id: resumeFrom.walletSetId,
  source_wallet_id: resumeFrom.sourceWallet.id,
  source_wallet_address: resumeFrom.sourceWallet.address,
  destination_wallet_id: resumeFrom.destinationWallet.id,
  destination_wallet_address: resumeFrom.destinationWallet.address,
  provider_token: { id: "USDC-ARC-TESTNET", symbol: "USDC", blockchain: "ARC-TESTNET", is_native: true, decimals: 18, token_address: null },
  preflight_captured_at: "2026-09-29T06:55:00.000Z",
};
const intentFingerprint = computeJ0dIntentFingerprint(approvedIntent);
const confirm = "RUN_J0D_CONNECTIVITY_SPIKE_ONCE";

// Deliberately bypasses the validating production helper: invalid schemas still
// receive a correct raw JCS fingerprint, so a 400 proves schema rejection.
function rawFingerprint(intent: unknown) {
  return createHash("sha256").update(canonicalize(intent), "utf8").digest("hex");
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/j0d/run-connectivity-spike", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
afterEach(() => {
  restoreEnv("CIRCLE_API_KEY", apiKey);
  restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
  vi.restoreAllMocks();
});

describe("intent-bound J0-D spike route", () => {
  it.each([
    ["a bare confirmation", { confirm }],
    ["confirmation + resume context without intent", { confirm, resumeFrom }],
    ["intent without resume context", { confirm, approvedIntent, intentFingerprint }],
    ["intent without fingerprint", { confirm, resumeFrom, approvedIntent }],
    ["the wrong confirmation literal", { confirm: "YES", resumeFrom, approvedIntent, intentFingerprint }],
    ["extra top-level fields", { confirm, resumeFrom, approvedIntent, intentFingerprint, faucet: true }],
    ["a self-transfer context", { confirm, resumeFrom: { ...resumeFrom, destinationWallet: resumeFrom.sourceWallet }, approvedIntent, intentFingerprint }],
  ])("refuses %s with 400 before any provider access", async (_label, body) => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await post(body);
    expect(response.status).toBe(400);
  });

  it.each([
    ["a v1 intent", { ...approvedIntent, intent_version: "J0D-EXACT-INTENT-v1" }],
    ["an intent with extra fields", { ...approvedIntent, amount_override: "5" }],
    ["an intent with a non-0.01 amount", { ...approvedIntent, amount: "1" }],
    ["a missing max_network_fee cap", (() => { const { max_network_fee: _cap, ...v } = approvedIntent; return v; })()],
    ["a missing max_total_debit cap", (() => { const { max_total_debit: _cap, ...v } = approvedIntent; return v; })()],
    ["a larger fee cap", { ...approvedIntent, max_network_fee: "0.003" }],
    ["a larger total cap", { ...approvedIntent, max_total_debit: "0.013" }],
    ["a noncanonical fee cap string", { ...approvedIntent, max_network_fee: "0.0020" }],
    ["a noncanonical total cap string", { ...approvedIntent, max_total_debit: "0.0120" }],
    ["a numeric fee cap", { ...approvedIntent, max_network_fee: 0 }],
    ["a null total cap", { ...approvedIntent, max_total_debit: null }],
    ["a zero fee cap", { ...approvedIntent, max_network_fee: "0" }],
    ["a zero total cap", { ...approvedIntent, max_total_debit: "0" }],
    ["a tighter fee cap", { ...approvedIntent, max_network_fee: "0.0015" }],
    ["a tighter total cap", { ...approvedIntent, max_total_debit: "0.0115" }],
    ["an estimate above its fixed cap", { ...approvedIntent, estimated_network_fee: "0.002000000000000001", minimum_required_total: "0.012000000000000001" }],
  ])("rejects %s as invalid intent schema with a matching fingerprint", async (_label, invalidIntent) => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await post({ confirm, resumeFrom, approvedIntent: invalidIntent, intentFingerprint: rawFingerprint(invalidIntent) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("approvedIntent returned by the read-only preflight") });
  });

  it("refuses a fingerprint mismatch with 409 before the credential check", async () => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await post({ confirm, resumeFrom, approvedIntent, intentFingerprint: "a".repeat(64) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ stage: "INTENT_FINGERPRINT_MISMATCH", transaction_submitted: false });
  });

  it("refuses a resume context that disagrees with the approved intent with 409", async () => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await post({ confirm, resumeFrom: { ...resumeFrom, walletSetId: "other-set" }, approvedIntent, intentFingerprint });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ stage: "RESUME_CONTEXT_INTENT_MISMATCH", transaction_submitted: false });
  });

  it("fails closed with 503 when a fully bound request has no Circle credentials", async () => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await post({ confirm, resumeFrom, approvedIntent, intentFingerprint });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ blocked_external: true });
  });
});
