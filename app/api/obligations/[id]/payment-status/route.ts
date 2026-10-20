import {existingPaymentStatus} from '../../../../../src/server/existing-payment-status';
import {methodNotAllowed} from '../../../../../src/server/route-access-policy';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return existingPaymentStatus(request,(await context.params).id);}
export const POST=methodNotAllowed;export const HEAD=methodNotAllowed;export const PUT=methodNotAllowed;export const PATCH=methodNotAllowed;export const DELETE=methodNotAllowed;export const OPTIONS=methodNotAllowed;
