import { randomUUID } from "node:crypto";

import type {
  ProviderAdapter,
  StatusResult,
  SubmitTransferParams,
  SubmitTransferResult,
} from "./provider-adapter";

interface FakeTransfer {
  idempotencyKey: string;
  destinationAddress: string;
  atomicAmount: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
}

export interface FakeProviderAdapterSnapshot {
  transfers_by_ref: Array<[string, FakeTransfer]>;
  refs_by_idempotency_key: Array<[string, string]>;
  outcome_queue: Array<"CONFIRMED" | "FAILED" | "TIMEOUT">;
  submission_count: number;
}

/**
 * Deterministic in-memory fake of a Circle/Arc-style provider, used for the
 * mocked golden path and all automated tests. Behaviour is scriptable via
 * `queueOutcome` so tests can exercise CONFIRMED, FAILED and UNKNOWN/timeout
 * paths without any network access.
 */
export class FakeProviderAdapter implements ProviderAdapter {
  readonly name = "fake-testnet";
  private readonly transfersByRef: Map<string, FakeTransfer>;
  private readonly refsByIdempotencyKey: Map<string, string>;
  private outcomeQueue: Array<"CONFIRMED" | "FAILED" | "TIMEOUT">;
  private submissionCount: number;

  constructor(snapshot?: FakeProviderAdapterSnapshot) {
    this.transfersByRef = new Map(snapshot?.transfers_by_ref ?? []);
    this.refsByIdempotencyKey = new Map(snapshot?.refs_by_idempotency_key ?? []);
    this.outcomeQueue = [...(snapshot?.outcome_queue ?? [])];
    this.submissionCount = snapshot?.submission_count ?? 0;
  }

  exportSnapshot(): FakeProviderAdapterSnapshot {
    return {
      transfers_by_ref: [...this.transfersByRef.entries()].map(([ref, transfer]) => [ref, { ...transfer }]),
      refs_by_idempotency_key: [...this.refsByIdempotencyKey.entries()],
      outcome_queue: [...this.outcomeQueue],
      submission_count: this.submissionCount,
    };
  }

  queueOutcome(outcome: "CONFIRMED" | "FAILED" | "TIMEOUT"): void {
    this.outcomeQueue.push(outcome);
  }

  getSubmissionCount(): number {
    return this.submissionCount;
  }

  async submitTransfer(params: SubmitTransferParams): Promise<SubmitTransferResult> {
    const existingRef = this.refsByIdempotencyKey.get(params.idempotencyKey);
    if (existingRef) {
      // Provider-side idempotency: a retried request with the same key never
      // creates a second transfer.
      return { providerRef: existingRef, status: "SUBMITTED" };
    }

    this.submissionCount += 1;
    const outcome = this.outcomeQueue.shift() ?? "CONFIRMED";
    const providerRef = `fake-tx-${randomUUID()}`;
    this.refsByIdempotencyKey.set(params.idempotencyKey, providerRef);

    if (outcome === "TIMEOUT") {
      // The request reached the provider (it is recorded) but the caller
      // never learns the outcome synchronously — exactly the case the
      // no-blind-retry rule exists for.
      this.transfersByRef.set(providerRef, {
        idempotencyKey: params.idempotencyKey,
        destinationAddress: params.destinationAddress,
        atomicAmount: params.atomicAmount,
        status: "PENDING",
      });
      return { providerRef, status: "UNKNOWN" };
    }

    this.transfersByRef.set(providerRef, {
      idempotencyKey: params.idempotencyKey,
      destinationAddress: params.destinationAddress,
      atomicAmount: params.atomicAmount,
      status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
    });
    return { providerRef, status: "SUBMITTED" };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const transfer = this.transfersByRef.get(providerRef);
    if (!transfer) {
      return { status: "UNKNOWN" };
    }
    if (transfer.status === "PENDING") {
      return { status: "UNKNOWN" };
    }
    return {
      status: transfer.status === "CONFIRMED" ? "CONFIRMED" : "FAILED",
      destinationAddress: transfer.destinationAddress,
      atomicAmount: transfer.atomicAmount,
    };
  }

  async getStatusByIdempotencyKey(idempotencyKey: string): Promise<StatusResult> {
    const providerRef = this.refsByIdempotencyKey.get(idempotencyKey);
    return providerRef ? this.getStatus(providerRef) : { status: "UNKNOWN" };
  }

  /** Test/demo hook: resolve a previously-timed-out transfer as if the chain finally confirmed it. */
  resolvePending(providerRef: string, outcome: "CONFIRMED" | "FAILED"): void {
    const transfer = this.transfersByRef.get(providerRef);
    if (transfer) {
      transfer.status = outcome;
    }
  }
}
