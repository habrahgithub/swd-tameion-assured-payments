import { z } from "zod";

export const CIRCLE_BALANCE_PAGE_SIZE = 50;
const MAX_BALANCE_PAGES = 20;

const pageSchema = z.object({
  headers: z.unknown().optional(),
  data: z.object({
    pagination: z.object({
      nextPageAfter: z.string().min(1).max(2048).nullable().optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

type CircleBalancePage = z.infer<typeof pageSchema>;

export interface CircleBalancePageClient {
  getWalletTokenBalance(input: {
    id: string;
    includeAll: true;
    pageSize: typeof CIRCLE_BALANCE_PAGE_SIZE;
    pageAfter?: string;
  }): Promise<unknown>;
}

export interface CircleCollectionPageClient {
  getPage(input: { pageSize: typeof CIRCLE_BALANCE_PAGE_SIZE; pageAfter?: string }): Promise<unknown>;
}

function linkValue(headers: unknown): unknown {
  if (!headers || typeof headers !== "object") return undefined;

  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") return (get as (name: string) => unknown).call(headers, "link");

  const key = Object.keys(headers).find((name) => name.toLowerCase() === "link");
  return key === undefined ? undefined : (headers as Record<string, unknown>)[key];
}

function linkPageAfter(headers: unknown): { present: boolean; next: string | null } {
  const raw = linkValue(headers);
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  if (values.length === 0) return { present: false, next: null };
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("CIRCLE_BALANCE_PAGINATION_INVALID");
  }

  const links: Array<{ rel: string; url: string }> = [];
  for (const part of values.join(",").split(/,\s*(?=<)/)) {
    const match = part.match(/^\s*<([^<>\r\n]+)>\s*;\s*rel\s*=\s*(?:"([A-Za-z][A-Za-z0-9_-]*)"|([A-Za-z][A-Za-z0-9_-]*))\s*$/i);
    if (!match) throw new Error("CIRCLE_BALANCE_PAGINATION_INVALID");
    links.push({ url: match[1], rel: String(match[2] || match[3]).toLowerCase() });
  }

  const allowedRelations = new Set(["next", "prev", "previous", "first", "last", "self"]);
  if (links.length === 0 || links.some((link) => !allowedRelations.has(link.rel)) ||
      !links.some((link) => link.rel === "first") || !links.some((link) => link.rel === "self")) {
    throw new Error("CIRCLE_BALANCE_PAGINATION_INVALID");
  }

  const nextLinks = links.filter((link) => link.rel === "next");
  if (nextLinks.length > 1) throw new Error("CIRCLE_BALANCE_PAGINATION_INVALID");
  if (nextLinks.length === 0) return { present: true, next: null };

  const url = new URL(nextLinks[0].url, "https://api.circle.com");
  const cursors = url.searchParams.getAll("pageAfter");
  if (cursors.length !== 1 || !cursors[0] || cursors[0].length > 2048) {
    throw new Error("CIRCLE_BALANCE_PAGINATION_INVALID");
  }
  return { present: true, next: cursors[0] };
}

function nextPageAfter(response: CircleBalancePage): string | null {
  const fromLink = linkPageAfter(response.headers);
  const fromBody = response.data.pagination;
  const bodyPresent = fromBody !== undefined;
  const hasBodyCursor = fromBody !== undefined && Object.prototype.hasOwnProperty.call(fromBody, "nextPageAfter");
  const bodyNext = fromBody?.nextPageAfter;

  if (bodyPresent && (!hasBodyCursor || bodyNext === undefined) && !fromLink.present) {
    throw new Error("CIRCLE_BALANCE_COMPLETENESS_UNVERIFIED");
  }

  if (fromLink.present && hasBodyCursor && fromLink.next !== bodyNext) {
    throw new Error("CIRCLE_BALANCE_PAGINATION_CONFLICT");
  }
  if (fromLink.present) return fromLink.next;
  if (bodyPresent && hasBodyCursor && bodyNext !== undefined) return bodyNext;
  throw new Error("CIRCLE_BALANCE_COMPLETENESS_UNVERIFIED");
}

/** Fetches every Circle balance page or fails closed; cursors are passed only to the SDK. */
export async function readCompleteCircleBalanceRows(
  client: CircleBalancePageClient,
  walletId: string,
  revalidate: () => Promise<void> = async () => {},
): Promise<unknown[]> {
  return readCompleteCircleCollectionRows({
    getPage: ({ pageSize, pageAfter }) => client.getWalletTokenBalance({
      id: walletId,
      includeAll: true,
      pageSize,
      ...(pageAfter ? { pageAfter } : {}),
    }),
  }, "tokenBalances", revalidate);
}

/** Fetches every bounded Circle collection page or fails closed on ambiguous completion. */
export async function readCompleteCircleCollectionRows(
  client: CircleCollectionPageClient,
  collectionKey: string,
  revalidate: () => Promise<void> = async () => {},
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_BALANCE_PAGES; page += 1) {
    await revalidate();
    const response = pageSchema.parse(await client.getPage({
      pageSize: CIRCLE_BALANCE_PAGE_SIZE,
      ...(cursor ? { pageAfter: cursor } : {}),
    }));
    await revalidate();
    rows.push(...z.array(z.unknown()).max(CIRCLE_BALANCE_PAGE_SIZE).parse(response.data[collectionKey]));

    const next = nextPageAfter(response);
    if (next === null) return rows;
    if (page === MAX_BALANCE_PAGES - 1 || seenCursors.has(next)) {
      throw new Error("CIRCLE_BALANCE_PAGINATION_INCOMPLETE");
    }

    seenCursors.add(next);
    cursor = next;
  }

  throw new Error("CIRCLE_BALANCE_PAGINATION_INCOMPLETE");
}
