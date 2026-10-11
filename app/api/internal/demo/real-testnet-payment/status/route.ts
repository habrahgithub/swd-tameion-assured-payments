import { NextResponse } from "next/server";

/** Lifecycle status now belongs to GET /api/obligations/[id], which resolves
 * the genuine source record, namespace-owned proxy, and worker ledger. */
export async function GET() {
  return NextResponse.json({ error: "Fixed synthetic status lane is retired; fetch the selected genuine obligation detail." }, { status: 410, headers: {"Cache-Control":"no-store"} });
}

import {methodNotAllowed} from "../../../../../../src/server/route-access-policy";
export const HEAD=methodNotAllowed;
export const POST=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
