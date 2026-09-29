import { NextResponse } from "next/server";

import {
  j0dPriorOutboundHttpStatus,
  j0dPriorOutboundRequestSchema,
  runJ0dPriorOutboundReconciliation,
} from "../../../../src/j0d-spike/prior-outbound-reconciliation";

/**
 * Read-only J0-D prior-outbound reconciliation (#40 B7-A).
 *
 * This route imports only the reconciliation module, whose sole Circle
 * capability is `listTransactions`. It cannot create transactions, wallets,
 * or faucet requests, sign anything, or reach the connectivity spike
 * execution path. The response is sanitized structural evidence of the
 * provider listing for the source wallet; it is not a retry decision and
 * does not change the spike's no-blind-retry guard.
 */
export async function POST(request: Request) {
  const parsed = j0dPriorOutboundRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Refusing reconciliation: POST body must contain only confirm="READ_J0D_PRIOR_OUTBOUND_ONLY" and a valid sourceWalletId.',
      },
      { status: 400 },
    );
  }

  const result = await runJ0dPriorOutboundReconciliation(parsed.data.sourceWalletId);
  return NextResponse.json({ result }, { status: j0dPriorOutboundHttpStatus(result) });
}
