import {financialHandlers} from '../../../../../src/server/operator-financial-routes';
import {sourceWorkflowHandlers} from '../../../../../src/server/source-workflow';
import {methodNotAllowed} from '../../../../../src/server/route-access-policy';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const id=(await context.params).id;
  return id.startsWith('TESTNET-CONTROLLED-')?financialHandlers('review',request,id):sourceWorkflowHandlers('review',request,id);
}
export const GET=methodNotAllowed;export const HEAD=methodNotAllowed;export const PUT=methodNotAllowed;export const PATCH=methodNotAllowed;export const DELETE=methodNotAllowed;export const OPTIONS=methodNotAllowed;
