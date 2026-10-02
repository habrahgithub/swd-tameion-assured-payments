import { z } from "zod";

import { ARC_TESTNET_BLOCKCHAIN, createCircleArcPriorOutboundReadClient } from "./circle-arc-client";
import { walletIdSchema } from "./intent";

/**
 * Read-only J0-D prior-outbound reconciliation (#40 B7-A, B7-B).
 *
 * Issues one provider listing chosen from a fixed probe enum and reports only
 * the sanitized structure of what Circle returned. FULL_CURRENT is exactly the
 * query the intent-bound spike uses for its no-blind-retry check (source
 * wallet, ARC-TESTNET, OUTBOUND, pageSize 1, DESC); the other probes drop
 * filters one step at a time so a provider rejection can be isolated (#40
 * B7-B). Callers select a probe but can never supply query parameters.
 * It deliberately draws no conclusion about whether a prior outbound
 * transaction exists: an omitted `data.transactions` field is reported as
 * omitted, not as empty. The spike's guard logic is unchanged by this module.
 */

export const J0D_PRIOR_OUTBOUND_CONFIRMATION = "READ_J0D_PRIOR_OUTBOUND_ONLY" as const;

export const J0D_PRIOR_OUTBOUND_PROBES = ["FULL_CURRENT", "WALLET_TXTYPE", "WALLET_ONLY", "UNFILTERED_ONE"] as const;

export const j0dPriorOutboundProbeSchema = z.enum(J0D_PRIOR_OUTBOUND_PROBES);

export type J0dPriorOutboundProbe = z.infer<typeof j0dPriorOutboundProbeSchema>;

/**
 * sourceWalletId stays required for every probe, including UNFILTERED_ONE,
 * which validates it but does not send it to the provider.
 */
export const j0dPriorOutboundRequestSchema = z.object({
  confirm: z.literal(J0D_PRIOR_OUTBOUND_CONFIRMATION),
  sourceWalletId: walletIdSchema,
  probe: j0dPriorOutboundProbeSchema,
}).strict();

const providerIdentifierSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const providerEnumSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);

const firstTransactionSchema = z.object({
  is_object: z.boolean(),
  id: providerIdentifierSchema.nullable(),
  transaction_type: providerEnumSchema.nullable(),
  state: providerEnumSchema.nullable(),
  wallet_id: providerIdentifierSchema.nullable(),
}).strict();

const providerErrorSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  status: z.number().int().min(100).max(599).nullable(),
  code: z.union([z.number().int(), z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)]).nullable(),
  message: z.string().max(300).nullable(),
}).strict();

/**
 * Effective query per probe. `custody_type` is never passed by this module:
 * SDK 10.8.1's `listTransactions` sends `custodyType=DEVELOPER` when it is
 * omitted, so it is on the wire for every probe and is reported as such.
 */
const sharedQueryShape = {
  custody_type: z.literal("DEVELOPER"),
  page_size: z.literal(1),
  order: z.literal("DESC"),
};

const querySchema = z.union([
  z.object({
    wallet_id: walletIdSchema,
    blockchain: z.literal(ARC_TESTNET_BLOCKCHAIN),
    tx_type: z.literal("OUTBOUND"),
    ...sharedQueryShape,
  }).strict(),
  z.object({ wallet_id: walletIdSchema, tx_type: z.literal("OUTBOUND"), ...sharedQueryShape }).strict(),
  z.object({ wallet_id: walletIdSchema, ...sharedQueryShape }).strict(),
  z.object(sharedQueryShape).strict(),
]);

const baseResultShape = {
  dispatch_profile: z.literal("J0_CONNECTIVITY_SPIKE"),
  action: z.literal("READ_ONLY_PRIOR_OUTBOUND_RECONCILIATION"),
  probe: j0dPriorOutboundProbeSchema,
  query: querySchema,
  captured_at: z.string().datetime({ offset: true }),
};

export const j0dPriorOutboundResultSchema = z.discriminatedUnion("provider_query", [
  z.object({
    ...baseResultShape,
    provider_query: z.literal("SUCCEEDED"),
    data_present: z.boolean(),
    transactions_present: z.boolean(),
    transactions_is_array: z.boolean(),
    transactions_count: z.number().int().min(0).nullable(),
    first_transaction: firstTransactionSchema.nullable(),
  }).strict(),
  z.object({
    ...baseResultShape,
    provider_query: z.literal("FAILED"),
    provider_error: providerErrorSchema,
  }).strict(),
  z.object({
    ...baseResultShape,
    provider_query: z.literal("NOT_CONFIGURED"),
    message: z.string().min(1).max(300),
  }).strict(),
]);

export type J0dPriorOutboundResult = z.infer<typeof j0dPriorOutboundResultSchema>;

type ProbePaging = { pageSize: 1; order: "DESC" };

/** The only listing inputs this path can produce, one per probe. */
export type J0dPriorOutboundListInput =
  | (ProbePaging & { walletIds: [string]; blockchain: typeof ARC_TESTNET_BLOCKCHAIN; txType: "OUTBOUND" })
  | (ProbePaging & { walletIds: [string]; txType: "OUTBOUND" })
  | (ProbePaging & { walletIds: [string] })
  | ProbePaging;

/** The only Circle capability this path receives: one read-only listing method. */
export interface J0dPriorOutboundReadClient {
  listTransactions(input: J0dPriorOutboundListInput): Promise<unknown>;
}

export interface RunJ0dPriorOutboundReconciliationOptions {
  client?: J0dPriorOutboundReadClient;
  now?: () => Date;
}

export function j0dPriorOutboundHttpStatus(result: J0dPriorOutboundResult): number {
  if (result.provider_query === "SUCCEEDED") return 200;
  if (result.provider_query === "NOT_CONFIGURED") return 503;
  return 502;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function describeFirstTransaction(value: unknown): z.infer<typeof firstTransactionSchema> {
  if (!isRecord(value)) {
    return { is_object: false, id: null, transaction_type: null, state: null, wallet_id: null };
  }
  return {
    is_object: true,
    id: pick(providerIdentifierSchema, value.id),
    transaction_type: pick(providerEnumSchema, value.transactionType),
    state: pick(providerEnumSchema, value.state),
    wallet_id: pick(providerIdentifierSchema, value.walletId),
  };
}

const REDACTED = "[REDACTED]";

/**
 * Bounds and redacts a provider error message. Configured credential values
 * are removed verbatim, and any API-key-shaped token or long opaque run
 * (hex/base64 secrets, ciphertexts, bearer tokens) is replaced, erring
 * toward over-redaction.
 */
export function sanitizeProviderMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  let text = message;
  for (const secret of [process.env.CIRCLE_API_KEY, process.env.CIRCLE_ENTITY_SECRET]) {
    if (secret) text = text.split(secret).join(REDACTED);
  }
  text = text
    .replace(/\b(?:TEST|LIVE)_API_KEY:\S*/gi, REDACTED)
    .replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, REDACTED)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length === 0 ? null : text.slice(0, 300);
}

export function sanitizeProviderError(error: unknown): z.infer<typeof providerErrorSchema> {
  const source: Record<string, unknown> = isRecord(error) ? error : {};
  const name = typeof source.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(source.name)
    ? source.name
    : "ProviderError";
  const status = typeof source.status === "number" && Number.isInteger(source.status) && source.status >= 100 && source.status <= 599
    ? source.status
    : null;
  const code = typeof source.code === "number" && Number.isSafeInteger(source.code)
    ? source.code
    : pick(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), source.code);
  return providerErrorSchema.parse({ name, status, code, message: sanitizeProviderMessage(source.message) });
}

/** Fixed probe-to-query mapping; nothing caller-supplied beyond the validated wallet id reaches it. */
function probeQuery(probe: J0dPriorOutboundProbe, walletId: string): {
  input: J0dPriorOutboundListInput;
  description: z.infer<typeof querySchema>;
} {
  const paging = { pageSize: 1, order: "DESC" } as const;
  const shared = { custody_type: "DEVELOPER", page_size: 1, order: "DESC" } as const;
  switch (probe) {
    case "FULL_CURRENT":
      return {
        input: { walletIds: [walletId], blockchain: ARC_TESTNET_BLOCKCHAIN, txType: "OUTBOUND", ...paging },
        description: { wallet_id: walletId, blockchain: ARC_TESTNET_BLOCKCHAIN, tx_type: "OUTBOUND", ...shared },
      };
    case "WALLET_TXTYPE":
      return {
        input: { walletIds: [walletId], txType: "OUTBOUND", ...paging },
        description: { wallet_id: walletId, tx_type: "OUTBOUND", ...shared },
      };
    case "WALLET_ONLY":
      return {
        input: { walletIds: [walletId], ...paging },
        description: { wallet_id: walletId, ...shared },
      };
    case "UNFILTERED_ONE":
      return { input: { ...paging }, description: { ...shared } };
    default: {
      const unreachable: never = probe;
      throw new Error(`Unknown J0-D prior-outbound probe: ${String(unreachable)}`);
    }
  }
}

export async function runJ0dPriorOutboundReconciliation(
  sourceWalletId: string,
  probe: J0dPriorOutboundProbe,
  options: RunJ0dPriorOutboundReconciliationOptions = {},
): Promise<J0dPriorOutboundResult> {
  const now = options.now ?? (() => new Date());
  const walletId = walletIdSchema.parse(sourceWalletId);
  const selectedProbe = j0dPriorOutboundProbeSchema.parse(probe);
  const { input, description } = probeQuery(selectedProbe, walletId);
  const base = {
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PRIOR_OUTBOUND_RECONCILIATION",
    probe: selectedProbe,
    query: querySchema.parse(description),
  } as const;

  let client = options.client;
  if (!client) {
    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
      return j0dPriorOutboundResultSchema.parse({
        ...base,
        provider_query: "NOT_CONFIGURED",
        message: "Circle credentials are not configured in this runtime; provider truth was not queried.",
        captured_at: now().toISOString(),
      });
    }
    client = createCircleArcPriorOutboundReadClient();
  }

  let response: unknown;
  try {
    response = await client.listTransactions(input);
  } catch (error) {
    return j0dPriorOutboundResultSchema.parse({
      ...base,
      provider_query: "FAILED",
      provider_error: sanitizeProviderError(error),
      captured_at: now().toISOString(),
    });
  }

  const data = isRecord(response) ? response.data : undefined;
  const dataPresent = isRecord(data);
  const transactionsPresent = dataPresent && Object.hasOwn(data, "transactions") && data.transactions !== undefined;
  const transactions = dataPresent ? data.transactions : undefined;
  const transactionsIsArray = Array.isArray(transactions);

  return j0dPriorOutboundResultSchema.parse({
    ...base,
    provider_query: "SUCCEEDED",
    data_present: dataPresent,
    transactions_present: transactionsPresent,
    transactions_is_array: transactionsIsArray,
    transactions_count: transactionsIsArray ? transactions.length : null,
    first_transaction: transactionsIsArray && transactions.length > 0 ? describeFirstTransaction(transactions[0]) : null,
    captured_at: now().toISOString(),
  });
}
