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

export type RecoveryWorkflowCapabilities = {
  status: "READY" | "MISSING" | "UNAVAILABLE" | "INCONSISTENT";
  reason_codes: string[];
  schema_version: number | null;
  available: {
    human_authorization_history: boolean;
    shared_wallet_namespace_lock: boolean;
    parent_child_retirement_lock: boolean;
    immutable_recovery_receipts: boolean;
  };
};

class SupabaseRpcHttpError extends Error {
  constructor(readonly status: number) { super("Supabase RPC failed."); }
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

  async readRecoveryWorkflowCapabilities():Promise<RecoveryWorkflowCapabilities> {
    const unavailable:RecoveryWorkflowCapabilities={status:"UNAVAILABLE",reason_codes:["CAPABILITY_RPC_UNAVAILABLE"],schema_version:null,available:{human_authorization_history:false,shared_wallet_namespace_lock:false,parent_child_retirement_lock:false,immutable_recovery_receipts:false}};
    let result:Record<string,unknown>;
    try { result=asRecord(await this.rpc('tameion_recovery_capabilities',{})); }
    catch(error) { return error instanceof SupabaseRpcHttpError&&error.status===404?{...unavailable,status:"MISSING",reason_codes:["CAPABILITY_RPC_MISSING"]}:unavailable; }
    const keys=["human_authorization_history","shared_wallet_namespace_lock","parent_child_retirement_lock","immutable_recovery_receipts"] as const;
    const available=Object.fromEntries(keys.map(key=>[key,result[key]===true])) as RecoveryWorkflowCapabilities["available"];
    const schemaVersion=Number.isSafeInteger(result.schema_version)?result.schema_version as number:null;
    const unknownKeys=Object.keys(result).some(key=>key!=="schema_version"&&!keys.includes(key as typeof keys[number]));
    if(unknownKeys||keys.some(key=>result[key]!==undefined&&typeof result[key]!=="boolean"))return {status:"INCONSISTENT",reason_codes:["CAPABILITY_RESULT_INCONSISTENT"],schema_version:schemaVersion,available};
    if(schemaVersion!==1)return {status:"MISSING",reason_codes:[schemaVersion===null?"CAPABILITY_SCHEMA_VERSION_MISMATCH":"CAPABILITY_SCHEMA_VERSION_MISMATCH"],schema_version:schemaVersion,available};
    const missing=keys.some(key=>available[key]!==true);
    return {status:missing?"MISSING":"READY",reason_codes:missing?["REQUIRED_CAPABILITY_MISSING"]:["CAPABILITY_CONTRACT_READY"],schema_version:schemaVersion,available};
  }

  async assertRecoveryWorkflowCapability():Promise<void> {
    if((await this.readRecoveryWorkflowCapabilities()).status!=="READY")throw new DemoStatePersistenceError('Recovery workflow migration capability unavailable.');
  }

  async loadOrSeed(namespace: string, initialSnapshot: Record<string, unknown>): Promise<DemoStateRevision> {
    const result = await this.rpc("tameion_state_load_or_seed", {
      p_namespace: namespace,
      p_initial_snapshot: initialSnapshot,
    });
    return parseRevision(result);
  }

  async loadExisting(namespace: string, signal?: AbortSignal): Promise<DemoStateRevision> {
    if (!namespace || namespace.length > 128) throw new DemoStatePersistenceError("Existing namespace is required.");
    return parseRevision(await this.rpc("tameion_state_load_existing", {p_namespace: namespace, p_expected_schema_version: 2}, signal));
  }

  async compareAndSet(
    namespace: string,
    expectedRevision: number,
    nextSnapshot: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<number> {
    let response: Record<string, unknown>;
    try {
      const result = await this.rpc("tameion_state_compare_and_set", {
        p_namespace: namespace,
        p_expected_revision: expectedRevision,
        p_next_snapshot: nextSnapshot,
      }, signal);
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

  private async rpc(functionName: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(5000);
    const response = await this.fetcher(`${this.baseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
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
      throw new SupabaseRpcHttpError(response.status);
    }
    const reader=response.body?.getReader();
    if(!reader)throw new DemoStatePersistenceError("Durable state response unavailable.");
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_097_152)throw new Error();chunks.push(part.value);}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{void reader.cancel().catch(()=>undefined);throw new DemoStatePersistenceError("Durable state response invalid or exceeds bound.");}
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
