import {disabledLane,methodNotAllowed} from "../../../../../src/server/route-access-policy";
export const POST= (..._args:unknown[])=>disabledLane("REQUESTER_UNVERIFIED",403);
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
