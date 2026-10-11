import {operatorHandlers} from "../../../../src/server/operator-auth";
import {methodNotAllowed} from "../../../../src/server/route-access-policy";
export const GET=operatorHandlers.session;
export const HEAD=methodNotAllowed;
export const POST=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
