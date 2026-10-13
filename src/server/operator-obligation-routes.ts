import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {methodNotAllowed} from './route-access-policy';
import {loadPublicSourceRecords,isCurrentSourceEligible} from './source-records';
import {loadOperatorSourceRecords,type OperatorSourceView,type OperatorStateBinding} from './operator-source-records';
import type {LiveUsageObligationRecord} from '../agent/context-builder';
import {loadExistingDemoState,DEMO_ORGANIZATION_ID,type ExistingState} from './load-existing-demo-state';
/** Explicit in-process seam for mock verification; runtime has no fixture mode. */
export function createObligationReaders(guard:(request:Request,post:boolean)=>Promise<AuthContext>,load:(records:readonly LiveUsageObligationRecord[],binding?:OperatorStateBinding)=>Promise<ExistingState>,source:()=>readonly LiveUsageObligationRecord[]|OperatorSourceView=()=>loadOperatorSourceRecords()??loadPublicSourceRecords()){
  async function read(request:Request,id?:string,packet=false){
    if(request.method!=='GET')return methodNotAllowed();
    try {
      const auth=await guard(request,false);
      const view=source();
      const records:readonly LiveUsageObligationRecord[]=Array.isArray(view)?view:(view as OperatorSourceView).records;
      const binding=Array.isArray(view)?undefined:(view as OperatorSourceView).state_binding;
      const sourceFingerprint=JSON.stringify(view);
      await auth.revalidate();
      if(id===undefined&&records.length===0)return privateJson({obligations:[],assessed_count:0,total_count:0});
      if(id!==undefined){
        const privateMember=records.some(record=>record.obligation_id===id);
        const mayView=privateMember||(binding===undefined&&isCurrentSourceEligible(DEMO_ORGANIZATION_ID,id));
        if(!mayView||(packet&&!isCurrentSourceEligible(DEMO_ORGANIZATION_ID,id)))return privateJson({error:'Obligation source record not found',code:'SRC-001'},404);
      }
      const state=await load(records,binding);await auth.revalidate();
      if(JSON.stringify(source())!==sourceFingerprint)throw new Error("OPERATOR_SOURCE_UNAVAILABLE");
      let response:Response;
      if(packet){const sealed=state.getSealedPae(id!);if(!sealed)return privateJson({error:'No sealed PAE for this obligation.'},409);const {buildJ2PrimeApprovalPacket,renderJ2PrimeApprovalPacketText}=await import('../pipeline/prime-approval-packet');const value=buildJ2PrimeApprovalPacket(sealed);response=privateJson({packet:value,text:renderJ2PrimeApprovalPacketText(value)});}
      else {const {projectObligationList,projectObligationDetail}=await import('./obligation-read-model');response=id===undefined?projectObligationList(state):projectObligationDetail(state,id,isCurrentSourceEligible(DEMO_ORGANIZATION_ID,id));}
      response.headers.set('Cache-Control','no-store');return response;
    }catch(error){return accessFailure(error);}
  }
  return {list:(request:Request)=>read(request),detail:(request:Request,id:string)=>read(request,id),packet:(request:Request,id:string)=>read(request,id,true)};
}
export const obligationReaders=createObligationReaders(operatorHandlers.guard,(records,binding)=>loadExistingDemoState(undefined,undefined,records,binding));
