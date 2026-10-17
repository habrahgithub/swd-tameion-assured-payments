import {obligationReaders} from "../../../../src/server/operator-obligation-routes";
import {methodNotAllowed} from "../../../../src/server/route-access-policy";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return obligationReaders.detail(request,(await context.params).id);}
export const HEAD=methodNotAllowed;
export const POST=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
