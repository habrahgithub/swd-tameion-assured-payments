import { NextResponse } from "next/server";

/** The legacy fixed-ID assessment lane is retired. Assessment belongs to the
 * selected genuine obligation route at /api/obligations/[id]/assess. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic assessment lane is retired; select and assess a frozen genuine obligation." }, { status: 410, headers: {"Cache-Control":"no-store"} });
}

import {methodNotAllowed} from "../../../../../../src/server/route-access-policy";
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
