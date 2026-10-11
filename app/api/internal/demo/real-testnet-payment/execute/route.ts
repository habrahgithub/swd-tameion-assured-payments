import { NextResponse } from "next/server";

/** Retire the fixed synthetic provider submission endpoint. The sole allowed
 * submission route resolves the selected source identity and exact PAE. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic submission lane is retired; execution must use the selected genuine obligation identity." }, { status: 410, headers: {"Cache-Control":"no-store"} });
}

import {methodNotAllowed} from "../../../../../../src/server/route-access-policy";
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
