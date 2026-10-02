import { NextResponse } from "next/server";

import {
  j0dPriorOutboundHttpStatus,
  j0dPriorOutboundRequestSchema,
  runJ0dPriorOutboundReconciliation,
} from "../../../../src/j0d-spike/prior-outbound-reconciliation";

/**
 * Read-only J0-D prior-outbound reconciliation (#40 B7-A, B7-B).
 *
 * This route imports only the reconciliation module, whose sole Circle
 * capability is `listTransactions`. It cannot create transactions, wallets,
 * or faucet requests, sign anything, or reach the connectivity spike
 * execution path. The caller picks one fixed probe and cannot supply query
 * parameters. The response is sanitized structural evidence of that provider
 * listing; it is not a retry decision and does not change the spike's
 * no-blind-retry guard.
 */
export async function POST(request: Request) {
  const parsed = j0dPriorOutboundRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Refusing reconciliation: POST body must contain only confirm="READ_J0D_PRIOR_OUTBOUND_ONLY", a valid sourceWalletId, ' +
          "and probe set to one of FULL_CURRENT, WALLET_TXTYPE, WALLET_ONLY, UNFILTERED_ONE.",
      },
      { status: 400 },
    );
  }

  const result = await runJ0dPriorOutboundReconciliation(parsed.data.sourceWalletId, parsed.data.probe);
  return NextResponse.json({ result }, { status: j0dPriorOutboundHttpStatus(result) });
}
