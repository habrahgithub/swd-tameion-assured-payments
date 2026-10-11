import {obligationReaders} from "../../../src/server/operator-obligation-routes";
import {methodNotAllowed} from "../../../src/server/route-access-policy";
export const GET=obligationReaders.list;
export const HEAD=methodNotAllowed;
export const POST=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
