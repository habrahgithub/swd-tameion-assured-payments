import {disabledLane,methodNotAllowed} from "../../../../../src/server/route-access-policy";
export const POST= (..._args:unknown[])=>disabledLane("LANE_NOT_ADMITTED",403);
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
export const maxDuration=60;
