import { describe, expect, it } from "vitest";

import {
  computeJ0dIntentFingerprint,
  computeJ0dExecutionIdentity,
  j0dExactIntentSchema,
  j0dIdempotencyKeyForExecutionIdentity,
  type J0dExactIntent,
} from "../src/j0d-spike/intent";

const intent: J0dExactIntent = {
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
  wallet_set_id: "2b72f116-16da-591a-9212-5382388a35c4",
  source_wallet_id: "9fe9c001-a044-5f9a-8997-165474887952",
  source_wallet_address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95",
  destination_wallet_id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3",
  destination_wallet_address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
  provider_token: { id: "USDC-ARC-TESTNET", symbol: "USDC", blockchain: "ARC-TESTNET", is_native: true, decimals: 18, token_address: null },
  preflight_captured_at: "2026-09-29T06:55:00.000Z",
};

describe("J0-D canonical exact intent and fingerprint", () => {
  it("is deterministic across key order and JSON round-trip", () => {
    const fingerprint = computeJ0dIntentFingerprint(intent);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(computeJ0dIntentFingerprint(JSON.parse(JSON.stringify(intent)))).toBe(fingerprint);
    const reordered = Object.fromEntries(Object.entries(intent).reverse()) as J0dExactIntent;
    expect(computeJ0dIntentFingerprint(reordered)).toBe(fingerprint);
  });

  it.each([
    ["source_wallet_id", { source_wallet_id: "other-source" }],
    ["source_wallet_address", { source_wallet_address: "0x1111111111111111111111111111111111111111" }],
    ["destination_wallet_id", { destination_wallet_id: "other-dest" }],
    ["destination_wallet_address", { destination_wallet_address: "0x2222222222222222222222222222222222222222" }],
    ["wallet_set_id", { wallet_set_id: "other-set" }],
    ["provider_token.id", { provider_token: { ...intent.provider_token, id: "OTHER" } }],
    ["provider_token.token_address", { provider_token: { ...intent.provider_token, token_address: "0x3600000000000000000000000000000000000000" } }],
    ["fee + total", { estimated_network_fee: "0.002000000000000000", minimum_required_total: "0.012000000000000000" }],
    ["decimals", { provider_token: { ...intent.provider_token, decimals: 6 }, estimated_network_fee: "0.001", minimum_required_total: "0.011" }],
    ["capture identity", { preflight_captured_at: "2026-09-29T06:56:00.000Z" }],
  ] as const)("changes when %s changes", (_label, change) => {
    expect(computeJ0dIntentFingerprint({ ...intent, ...change } as J0dExactIntent)).not.toBe(computeJ0dIntentFingerprint(intent));
  });

  it.each([
    ["v1 version", { intent_version: "J0D-EXACT-INTENT-v1" }],
    ["missing max network fee", { max_network_fee: undefined }],
    ["missing max total debit", { max_total_debit: undefined }],
    ["larger network fee cap", { max_network_fee: "0.003" }],
    ["larger total cap", { max_total_debit: "0.013" }],
    ["zero network fee cap", { max_network_fee: "0" }],
    ["zero total cap", { max_total_debit: "0" }],
    ["tighter network fee cap", { max_network_fee: "0.0015" }],
    ["tighter total debit cap", { max_total_debit: "0.0115" }],
    ["amount", { amount: "0.02" }],
    ["fee level", { fee_level: "HIGH" }],
    ["network", { network: "ETH-SEPOLIA" }],
    ["non-native token", { provider_token: { ...intent.provider_token, is_native: false } }],
    ["total not amount + fee", { minimum_required_total: "0.010000000000000000" }],
    ["zero fee", { estimated_network_fee: "0", minimum_required_total: "0.01" }],
    ["fee above fixed cap", { estimated_network_fee: "0.002000000000000001", minimum_required_total: "0.012000000000000001" }],
    ["fee cap is not the fixed literal", { max_network_fee: "0.002000000000000001" }],
    ["total cap is not the fixed literal", { max_total_debit: "0.012000000000000001" }],
    ["total cap not above amount", { max_total_debit: "0.01" }],
    ["fee beyond token precision", { provider_token: { ...intent.provider_token, decimals: 2 } }],
    ["float-looking fee", { estimated_network_fee: "1e-3" }],
    ["self-transfer id", { destination_wallet_id: intent.source_wallet_id }],
    ["self-transfer address", { destination_wallet_address: intent.source_wallet_address.toUpperCase().replace("0X", "0x") }],
    ["extra field", { execute: true }],
  ])("rejects an intent with invalid %s", (_label, change) => {
    expect(j0dExactIntentSchema.safeParse({ ...intent, ...change }).success).toBe(false);
    expect(() => computeJ0dIntentFingerprint({ ...intent, ...change } as unknown as J0dExactIntent)).toThrow();
  });

  it("reports both aligned ceiling errors when fee and exact total exceed their fixed limits", () => {
    const fee = j0dExactIntentSchema.safeParse({ ...intent, estimated_network_fee: "0.002000000000000001", minimum_required_total: "0.012000000000000001" });
    const total = j0dExactIntentSchema.safeParse({ ...intent, estimated_network_fee: "0.002000000000000001", minimum_required_total: "0.012000000000000001" });
    expect(fee.success).toBe(false);
    if (!fee.success) expect(fee.error.issues.map((issue) => issue.path)).toContainEqual(["estimated_network_fee"]);
    expect(total.success).toBe(false);
    if (!total.success) expect(total.error.issues.map((issue) => issue.path)).toContainEqual(["minimum_required_total"]);
  });

  it("derives a deterministic UUIDv4-shaped Circle idempotency key from stable execution identity", () => {
    const identity = computeJ0dExecutionIdentity(intent);
    const key = j0dIdempotencyKeyForExecutionIdentity(identity);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(j0dIdempotencyKeyForExecutionIdentity(identity)).toBe(key);
    expect(j0dIdempotencyKeyForExecutionIdentity("0".repeat(64))).not.toBe(key);
    expect(() => j0dIdempotencyKeyForExecutionIdentity("nope")).toThrow();
  });

  it("keeps stable execution identity/key across estimate and timestamp changes", () => {
    const changedEvidence = { ...intent, estimated_network_fee: "0.0015", minimum_required_total: "0.0115", preflight_captured_at: "2026-09-29T07:01:00.000Z" };
    expect(computeJ0dIntentFingerprint(changedEvidence)).not.toBe(computeJ0dIntentFingerprint(intent));
    const identity = computeJ0dExecutionIdentity(intent);
    expect(computeJ0dExecutionIdentity(changedEvidence)).toBe(identity);
    expect(j0dIdempotencyKeyForExecutionIdentity(computeJ0dExecutionIdentity(changedEvidence))).toBe(j0dIdempotencyKeyForExecutionIdentity(identity));
  });

  it("binds the fuller v2 provider-token identity in stable execution identity", () => {
    expect(computeJ0dExecutionIdentity({ ...intent, provider_token: { ...intent.provider_token, token_address: "0x3600000000000000000000000000000000000000" } })).not.toBe(computeJ0dExecutionIdentity(intent));
  });

  it.each([
    ["source", { source_wallet_id: "new-source" }],
    ["destination", { destination_wallet_address: "0x1111111111111111111111111111111111111111" }],
    ["token", { provider_token: { ...intent.provider_token, id: "new-token" } }],
    ["wallet set", { wallet_set_id: "new-wallet-set" }],
  ] as const)("changes stable execution identity when %s changes", (_label, change) => {
    expect(computeJ0dExecutionIdentity({ ...intent, ...change } as J0dExactIntent)).not.toBe(computeJ0dExecutionIdentity(intent));
  });
});
