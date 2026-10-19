import {genuineWorkflowHandlers} from '../../../../../../src/server/genuine-workflow';
import {methodNotAllowed} from '../../../../../../src/server/route-access-policy';
/** The shared workflow authenticates the operator and CSRF before reading the explicit admission selector. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return genuineWorkflowHandlers('disposition',request,(await context.params).id);}
export const GET=methodNotAllowed;export const HEAD=methodNotAllowed;export const OPTIONS=methodNotAllowed;
export const PUT=methodNotAllowed;export const PATCH=methodNotAllowed;export const DELETE=methodNotAllowed;
export const maxDuration=60;
