import {accessFailure,operatorHandlers,privateJson} from '../../../../../src/server/operator-auth';
import {AccessError,methodNotAllowed,readBoundedJson,requireJson} from '../../../../../src/server/route-access-policy';
import {isBalancePinValid} from '../../../../../src/server/operator-wallet-balance';

function requireDiagnosticPreview():void {
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_PROJECT_ID!=='prj_SRsrBlbXY4GvrO8LONqbVW0yTFfg'||process.env.VERCEL_GIT_COMMIT_REF!=='codex/ui-ux-corrections-20261014')throw new AccessError('ACCESS_DENIED');
}

/** Temporary #65 probe: remove at submission freeze after the approved check.
 * No UI entry, provider capability, balance read or credential verification. */
export async function POST(request:Request):Promise<Response> {
 if(request.method!=='POST')return methodNotAllowed();
 try {
  requireDiagnosticPreview();
  requireJson(request);
  if(Object.keys(await readBoundedJson(request,128)).length)throw new AccessError('BODY_REJECTED',400);
  const ctx=await operatorHandlers.guard(request,true);
  await ctx.revalidate();
  requireDiagnosticPreview();
  const result={pin_valid:isBalancePinValid(process.env.TAMEION_BALANCE_PIN),api_key_present:typeof process.env.CIRCLE_API_KEY==='string'&&process.env.CIRCLE_API_KEY.length>0};
  await ctx.revalidate();
  requireDiagnosticPreview();
  return privateJson(result);
 }catch(error){return accessFailure(error);}
}

export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
