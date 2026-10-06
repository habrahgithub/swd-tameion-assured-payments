export interface DemoStateRevision {
  revision: number;
  snapshot: Record<string, unknown>;
}

export class DemoStatePersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DemoStatePersistenceError";
  }
}

export class DemoStateConflictError extends DemoStatePersistenceError {
  constructor() {
    super("Durable demo state changed during this request; reload current state and retry the human action.");
    this.name = "DemoStateConflictError";
  }
}

/** Server-only PostgREST RPC adapter. Credentials are never included in errors or logs. */
export class SupabaseDemoStateRepository {
  private readonly baseUrl: string;

  constructor(
    url: string,
    private readonly serviceRoleKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  async loadOrSeed(namespace: string, initialSnapshot: Record<string, unknown>): Promise<DemoStateRevision> {
    const result = await this.rpc("tameion_state_load_or_seed", {
      p_namespace: namespace,
      p_initial_snapshot: initialSnapshot,
    });
    return parseRevision(result);
  }

  async compareAndSet(
    namespace: string,
    expectedRevision: number,
    nextSnapshot: Record<string, unknown>,
  ): Promise<number> {
    let response: Record<string, unknown>;
    try {
      const result = await this.rpc("tameion_state_compare_and_set", {
        p_namespace: namespace,
        p_expected_revision: expectedRevision,
        p_next_snapshot: nextSnapshot,
      });
      response = asRecord(result);
    } catch (error) {
      throw new DemoStatePersistenceError("Durable demo-state compare-and-set failed.", { cause: error });
    }
    if (response.accepted !== true) throw new DemoStateConflictError();
    if (!Number.isSafeInteger(response.revision) || (response.revision as number) !== expectedRevision + 1) {
      throw new DemoStatePersistenceError("Supabase returned an invalid durable-state revision.");
    }
    return response.revision as number;
  }

  private async rpc(functionName: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Do not surface provider bodies: they may contain request details.
      throw new Error(`Supabase durable-state RPC ${functionName} failed (HTTP ${response.status}).`);
    }
    return response.json();
  }
}

function parseRevision(value: unknown): DemoStateRevision {
  const record = asRecord(value);
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new Error("Supabase returned an invalid durable-state revision.");
  }
  return { revision: record.revision as number, snapshot: asRecord(record.snapshot) };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Supabase returned malformed durable demo state.");
  }
  return value as Record<string, unknown>;
}
