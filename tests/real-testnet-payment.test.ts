import { describe, expect, it, vi } from "vitest";

import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  J2A_MAX_NETWORK_FEE,
  J2A_MAX_TOTAL_DEBIT,
  J2A_TRANSFER_AMOUNT,
  buildJ2aExecutionPacket,
  buildJ2aDemoObligation,
  buildJ2aDemoAggregate,
  buildJ2aCircleArcExecutionInstruction,
  buildJ2aIntentIdentity,
  hashJ2aPreflightEvidence,
  hashJ2aExecutionPacket,
  runJ2aReadOnlyPreflight,
  type J2aPreflightClient,
} from "../src/demo/real-testnet-payment";

const capturedAt = "2026-10-04T12:00:00.000Z";

function wallet(id: string, address: string) {
  return { id, address, blockchain: "ARC-TESTNET", walletSetId: J2A_DEMO_WALLET_SET_ID, state: "LIVE" };
}

function providerTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "prior-transaction",
    state: "COMPLETE",
    transactionType: "OUTBOUND",
    blockchain: "ARC-TESTNET",
    walletId: J2A_DEMO_SOURCE.id,
    destinationAddress: "0x0000000000000000000000000000000000000001",
    amounts: ["1.000000"],
    tokenId: "native-arc-usdc",
    refId: "prior-reference",
    ...overrides,
  };
}

function client(overrides: Partial<J2aPreflightClient> = {}): J2aPreflightClient {
  return {
    getWallet: vi.fn(async ({ id }: { id: string }) => ({
      data: { wallet: id === J2A_DEMO_SOURCE.id ? wallet(J2A_DEMO_SOURCE.id, J2A_DEMO_SOURCE.address) : wallet(J2A_DEMO_DESTINATION.id, J2A_DEMO_DESTINATION.address) },
    })),
    getWalletTokenBalance: vi.fn(async () => ({
      data: { tokenBalances: [{
        amount: "10.000000",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] },
    })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction()] } })),
    ...overrides,
  };
}

describe("J2A real Arc Testnet demo preflight", () => {
  it("pins the exact test wallets, fixed amount, network, token and capped fee", async () => {
    const api = client();
    const result = await runJ2aReadOnlyPreflight(api, () => new Date(capturedAt));

    expect(result.readiness).toBe("READY");
    if (result.readiness !== "READY") throw new Error("expected ready preflight");
    expect(result).toMatchObject({
      profile: "J2A_REAL_TESTNET_DEMO",
      amount: J2A_TRANSFER_AMOUNT,
      asset: "USDC",
      network: "ARC_TESTNET",
      max_network_fee: J2A_MAX_NETWORK_FEE,
      max_total_debit: J2A_MAX_TOTAL_DEBIT,
      source_wallet: { ...J2A_DEMO_SOURCE, state: "LIVE" },
      destination_wallet: { ...J2A_DEMO_DESTINATION, state: "LIVE" },
      wallet_set_id: J2A_DEMO_WALLET_SET_ID,
      beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
      provider_token: { id: "native-arc-usdc", symbol: "USDC", decimals: 6 },
      estimated_network_fee: "0.001000",
      captured_at: capturedAt,
      prior_matching_outbound: false,
    });
    expect(result.evidence_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(api.getWallet).toHaveBeenCalledTimes(2);
    expect(api.getWalletTokenBalance).toHaveBeenCalledWith({ id: J2A_DEMO_SOURCE.id, includeAll: true });
    expect(api.estimateTransferFee).toHaveBeenCalledWith(expect.objectContaining({
      walletId: J2A_DEMO_SOURCE.id,
      tokenId: "native-arc-usdc",
      amount: [J2A_TRANSFER_AMOUNT],
      destinationAddress: J2A_DEMO_DESTINATION.address,
    }));
    expect(api.listTransactions).toHaveBeenCalledWith({
      txType: "OUTBOUND",
      walletIds: [J2A_DEMO_SOURCE.id],
      pageSize: 50,
      order: "DESC",
    });
  });

  it("uses Circle's provider-reported native Arc USDC precision while retaining the fixed six-place demo amount", async () => {
    const api = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
    });

    const result = await runJ2aReadOnlyPreflight(api, () => new Date(capturedAt));

    expect(result).toMatchObject({
      readiness: "READY",
      amount: "5.000000",
      provider_token: { id: "native-arc-usdc", symbol: "USDC", decimals: 18, native: true },
      source_balance: "19.989211477825042",
      estimated_network_fee: "0.0011679675",
      max_network_fee: J2A_MAX_NETWORK_FEE,
      max_total_debit: J2A_MAX_TOTAL_DEBIT,
    });
    if (result.readiness !== "READY") throw new Error("expected ready preflight");
    expect(buildJ2aCircleArcExecutionInstruction(result, "fixed-demo-execution")).toMatchObject({
      decimals: 18,
      amount: "5.000000",
      max_network_fee: "0.002000",
      circle_request: { amount: ["5.000000"], tokenId: "native-arc-usdc" },
    });
    expect(hashJ2aPreflightEvidence({
      ...result,
      provider_token: { ...result.provider_token, decimals: 6 },
    } as unknown as Record<string, unknown>)).not.toBe(result.evidence_sha256);
    expect(api.estimateTransferFee).toHaveBeenCalledWith(expect.objectContaining({ amount: ["5.000000"] }));
  });

  it("compares provider balance and fee ceilings at all reported decimals without truncation", async () => {
    const belowRequiredBalance = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "5.001167967499999999",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
    });
    expect(await runJ2aReadOnlyPreflight(belowRequiredBalance)).toMatchObject({ readiness: "BLOCKED", blocker: "INSUFFICIENT_BALANCE" });

    const overFeeCap = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.002000000000000001" } } })),
    });
    expect(await runJ2aReadOnlyPreflight(overFeeCap)).toMatchObject({ readiness: "BLOCKED", blocker: "FEE_CAP_EXCEEDED" });

    const highPrecisionPriorOutbound = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
      listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction({
        transactionType: "OUTBOUND",
        destinationAddress: J2A_DEMO_DESTINATION.address,
        amounts: ["5.000000000000000000"],
      })] } })),
    });
    expect(await runJ2aReadOnlyPreflight(highPrecisionPriorOutbound)).toMatchObject({ readiness: "BLOCKED", blocker: "PRIOR_MATCHING_OUTBOUND" });
  });

  it("keeps the demo business dates stable across preflight capture dates", async () => {
    const first = await runJ2aReadOnlyPreflight(client(), () => new Date("2026-10-04T23:59:00.000Z"));
    const nextDay = await runJ2aReadOnlyPreflight(client(), () => new Date("2026-10-05T00:01:00.000Z"));

    expect(first.readiness).toBe("READY");
    expect(nextDay.readiness).toBe("READY");
    if (first.readiness !== "READY" || nextDay.readiness !== "READY") throw new Error("expected ready preflights");
    expect(first.captured_at).not.toBe(nextDay.captured_at);
    expect(first.business_payment_instruction).toEqual(nextDay.business_payment_instruction);
    expect(first.business_payment_instruction.commercial).toMatchObject({
      invoice_date: "2026-10-04",
      effective_due_date: "2026-10-04",
    });
  });

  it("recognizes an exact prior outbound using Circle SDK transactionType", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction({
        transactionType: "OUTBOUND",
        destinationAddress: J2A_DEMO_DESTINATION.address,
        amounts: [J2A_TRANSFER_AMOUNT],
      })] } })),
    }), () => new Date(capturedAt));

    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "PRIOR_MATCHING_OUTBOUND" });
  });

  it("fails closed when source wallet identity differs", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async () => ({ data: { wallet: wallet("wrong-wallet", J2A_DEMO_SOURCE.address) } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "SOURCE_WALLET_MISMATCH" });
  });

  it("fails closed when destination address differs", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: id === J2A_DEMO_SOURCE.id
        ? wallet(J2A_DEMO_SOURCE.id, J2A_DEMO_SOURCE.address)
        : wallet(J2A_DEMO_DESTINATION.id, "0x0000000000000000000000000000000000000002") } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "DESTINATION_WALLET_MISMATCH" });
  });

  it("fails closed when either wallet is not LIVE", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: {
        ...wallet(id, id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address),
        state: "FROZEN",
      } } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "WALLET_NOT_LIVE" });
  });

  it("blocks when current balance does not cover exactly 5 USDC plus the estimated fee", async () => {
    const api = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "5.000999",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] } })),
    });
    const result = await runJ2aReadOnlyPreflight(api);
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "INSUFFICIENT_BALANCE" });
    expect(api.estimateTransferFee).toHaveBeenCalledTimes(1);
  });

  it("blocks when the fresh fee exceeds the fixed network-fee ceiling", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.002001" } } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "FEE_CAP_EXCEEDED" });
  });

  it("blocks an exact prior 5 USDC outbound to this demo counterparty", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction({
        transactionType: "OUTBOUND",
        destinationAddress: J2A_DEMO_DESTINATION.address,
        amounts: [J2A_TRANSFER_AMOUNT],
      })] } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "PRIOR_MATCHING_OUTBOUND" });
  });

  it("does not prepare an isolated demo aggregate until read-only provider truth is READY", async () => {
    const ready = await runJ2aReadOnlyPreflight(client(), () => new Date(capturedAt));
    expect(ready.readiness).toBe("READY");
    if (ready.readiness !== "READY") throw new Error("expected ready preflight");
    const aggregate = buildJ2aDemoAggregate(ready);

    expect(aggregate).toMatchObject({
      organization_id: "ORG-TAMEION-TESTNET-DEMO",
      obligation_id: "DEMO-ARC-TESTNET-001",
      aggregate_version: 1,
      amount: "5.000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      destination_ref: `CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`,
      destination_address: J2A_DEMO_DESTINATION.address,
      source_wallet_ref: J2A_DEMO_SOURCE.id,
      evidence_hashes: [ready.evidence_sha256],
    });
    expect(ready.evidence_sha256).toBeTruthy();
    expect(buildJ2aIntentIdentity(ready, aggregate)).toEqual({
      payer: {
        organization_id: "ORG-TAMEION-TESTNET-DEMO",
        organization_name: "Tameion Testnet Demonstration Organization",
        wallet_id: J2A_DEMO_SOURCE.id,
        wallet_address: J2A_DEMO_SOURCE.address,
        provider_wallet_status: "LIVE",
        assurance_wallet_status: "ACTIVE",
        wallet_version: 1,
        wallet_set_id: J2A_DEMO_WALLET_SET_ID,
        provider: "Circle Developer-Controlled Wallets",
      },
      beneficiary: {
        beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
        name: J2A_DEMO_DESTINATION.name,
        wallet_id: J2A_DEMO_DESTINATION.id,
        destination_ref: `CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`,
        wallet_address: J2A_DEMO_DESTINATION.address,
        provider_wallet_status: "LIVE",
        verification_status: "VERIFIED",
        verification_version: 1,
        operational_status: "ACTIVE",
        operational_version: 1,
      },
    });
  });

  it("uses an explicit synthetic invoice date equal to effective due date under the prototype cash-payment basis", async () => {
    const ready = await runJ2aReadOnlyPreflight(client(), () => new Date(capturedAt));
    expect(ready.readiness).toBe("READY");
    if (ready.readiness !== "READY") throw new Error("expected ready preflight");

    expect(buildJ2aDemoObligation(ready)).toMatchObject({
      organization_id: "ORG-TAMEION-TESTNET-DEMO",
      organization_name: "Tameion Testnet Demonstration Organization",
      obligation_id: "DEMO-ARC-TESTNET-001",
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      invoice_date: "2026-10-04",
      effective_due_date: "2026-10-04",
      payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE",
      source_evidence_id: "J2A-DEMO-OBLIGATION-SYNTHETIC-EVIDENCE-001",
    });
  });

  it("binds payer and beneficiary identities into the exact Prime execution packet", async () => {
    const preflight = await runJ2aReadOnlyPreflight(client(), () => new Date(capturedAt));
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready preflight");
    const aggregate = buildJ2aDemoAggregate(preflight);
    const packet = buildJ2aExecutionPacket({
      preflight,
      aggregate,
      assessment: {
        assessment_id: "ASM-J2A-1",
        aggregate_version: String(aggregate.aggregate_version),
        decision: "PAY",
        provider_mode: "LIVE_AI",
        provider_name: "NVIDIA Build",
        model_id: "nvidia/nemotron-3-super-120b-a12b",
        model_config_version: "test-config",
      } as never,
      assessmentHash: "a".repeat(64),
      sealedPae: {
        instruction_hash: "b".repeat(64),
        payload: {
          instruction_id: "PAE-J2A-1",
          signing_key_id: "J2A-KEY-1",
          aggregate_version: String(aggregate.aggregate_version),
          expiry: "2026-10-04T13:00:00.000Z",
          idempotency_key: "idem-j2a-1",
        },
      } as never,
    });

    expect(packet.packet).toMatchObject({
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      business_payment_instruction: {
        payer: {
          organization_id: "ORG-TAMEION-TESTNET-DEMO",
          display_name: "Tameion Testnet Demonstration Organization",
          business_postal_address: { status: "NOT_PROVIDED_IN_SOURCE" },
          jurisdiction: { status: "NOT_PROVIDED_IN_SOURCE" },
        },
        beneficiary: {
          beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
          display_name: "Tameion Test Counterparty",
          business_postal_address: {
            status: "NOT_APPLICABLE_TEST_COUNTERPARTY",
            statement: "No real postal address applies to the synthetic non-economic test counterparty.",
            classification: "SYNTHETIC_DEMO_METADATA",
          },
        },
        commercial: {
          invoice_reference: "DEMO-ARC-TESTNET-001",
          invoice_date: "2026-10-04",
          effective_due_date: "2026-10-04",
          payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE",
          particulars: "Non-economic Arc Testnet demonstration to the synthetic test counterparty.",
        },
      },
      circle_arc_execution_instruction: {
        network: "ARC-TESTNET",
        chain_id: 5042002,
        gas_currency: "USDC",
        amount: "5.000000",
        decimals: 6,
        max_network_fee: "0.002000",
        max_total_debit: "5.012000",
        circle_request: {
          walletId: J2A_DEMO_SOURCE.id,
          destinationAddress: J2A_DEMO_DESTINATION.address,
          amount: ["5.000000"],
          tokenId: "native-arc-usdc",
          fee: { type: "level", config: { feeLevel: "MEDIUM" } },
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
          refId: expect.stringMatching(/^j2a-[0-9a-f]{28}$/),
        },
      },
      demo_obligation: {
        invoice_date: "2026-10-04",
        effective_due_date: "2026-10-04",
        payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE",
      },
      payer: {
        organization_id: "ORG-TAMEION-TESTNET-DEMO",
        wallet_id: J2A_DEMO_SOURCE.id,
        wallet_address: J2A_DEMO_SOURCE.address,
        wallet_version: 1,
        wallet_set_id: J2A_DEMO_WALLET_SET_ID,
      },
      beneficiary: {
        beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
        wallet_id: J2A_DEMO_DESTINATION.id,
        destination_ref: `CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`,
        wallet_address: J2A_DEMO_DESTINATION.address,
        verification_status: "VERIFIED",
        operational_status: "ACTIVE",
      },
      settlement_amount: J2A_TRANSFER_AMOUNT,
      asset: "USDC",
      network: "ARC_TESTNET",
    });
    expect(packet.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hashJ2aPreflightEvidence(preflight as unknown as Record<string, unknown>)).toBe(preflight.evidence_sha256);

    const changedBusinessIdentity = {
      ...preflight,
      business_payment_instruction: {
        ...preflight.business_payment_instruction,
        beneficiary: {
          ...preflight.business_payment_instruction.beneficiary,
          display_name: "Changed test identity",
        },
      },
    };
    const changedPreflight = {
      ...changedBusinessIdentity,
      evidence_sha256: hashJ2aPreflightEvidence(changedBusinessIdentity as unknown as Record<string, unknown>),
    };
    const changedPacket = buildJ2aExecutionPacket({
      preflight: changedPreflight,
      aggregate,
      assessment: {
        assessment_id: "ASM-J2A-1",
        aggregate_version: String(aggregate.aggregate_version),
        decision: "PAY",
        provider_mode: "LIVE_AI",
        provider_name: "NVIDIA Build",
        model_id: "nvidia/nemotron-3-super-120b-a12b",
        model_config_version: "test-config",
      } as never,
      assessmentHash: "a".repeat(64),
      sealedPae: {
        instruction_hash: "b".repeat(64),
        payload: {
          instruction_id: "PAE-J2A-1", signing_key_id: "J2A-KEY-1",
          aggregate_version: String(aggregate.aggregate_version), expiry: "2026-10-04T13:00:00.000Z",
          idempotency_key: "idem-j2a-1",
        },
      } as never,
    });
    expect(changedPacket.packet_sha256).not.toBe(packet.packet_sha256);
    expect(changedPreflight.evidence_sha256).not.toBe(preflight.evidence_sha256);

    const changedPayerInstruction = {
      ...preflight.business_payment_instruction,
      payer: { ...preflight.business_payment_instruction.payer, display_name: "Changed payer identity" },
    };
    expect(hashJ2aPreflightEvidence({ ...preflight, business_payment_instruction: changedPayerInstruction } as unknown as Record<string, unknown>))
      .not.toBe(preflight.evidence_sha256);
    expect(hashJ2aExecutionPacket({
      ...packet.packet,
      business_payment_instruction: { ...packet.packet.business_payment_instruction, payer: changedPayerInstruction.payer },
    })).not.toBe(packet.packet_sha256);
  });
});
