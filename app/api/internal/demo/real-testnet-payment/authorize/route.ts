import { NextResponse } from "next/server";

/** Authorization is available only through the selected genuine obligation
 * route, which resolves current LIVE_AI assessment and its bound proxy. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic authorization lane is retired; use the selected genuine obligation lifecycle." }, { status: 410, headers: {"Cache-Control":"no-store"} });
}

import {methodNotAllowed} from "../../../../../../src/server/route-access-policy";
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
