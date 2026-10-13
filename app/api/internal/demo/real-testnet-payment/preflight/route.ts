import {financialHandlers} from "../../../../../../src/server/operator-financial-routes";
import {methodNotAllowed} from "../../../../../../src/server/route-access-policy";
export const POST=(request:Request)=>financialHandlers("preflight",request);
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
