import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {methodNotAllowed} from './route-access-policy';
import {loadPublicSourceRecords,isCurrentSourceEligible} from './source-records';
import {loadExistingDemoState,DEMO_ORGANIZATION_ID,type ExistingState} from './load-existing-demo-state';
/** Explicit in-process seam for mock verification; runtime has no fixture mode. */
export function createObligationReaders(guard:(request:Request,post:boolean)=>Promise<AuthContext>,load:()=>Promise<ExistingState>){
  async function read(request:Request,id?:string,packet=false){
    if(request.method!=='GET')return methodNotAllowed();
    try {
      const auth=await guard(request,false);
      if(id===undefined&&loadPublicSourceRecords().length===0)return privateJson({obligations:[],assessed_count:0,total_count:0});
      if(id!==undefined&&!isCurrentSourceEligible(DEMO_ORGANIZATION_ID,id))return privateJson({error:'Obligation source record not found',code:'SRC-001'},404);
      const state=await load();await auth.revalidate();
      let response:Response;
      if(packet){const sealed=state.getSealedPae(id!);if(!sealed)return privateJson({error:'No sealed PAE for this obligation.'},409);const {buildJ2PrimeApprovalPacket,renderJ2PrimeApprovalPacketText}=await import('../pipeline/prime-approval-packet');const value=buildJ2PrimeApprovalPacket(sealed);response=privateJson({packet:value,text:renderJ2PrimeApprovalPacketText(value)});}
      else {const {projectObligationList,projectObligationDetail}=await import('./obligation-read-model');response=id===undefined?projectObligationList(state):projectObligationDetail(state,id);}
      response.headers.set('Cache-Control','no-store');return response;
    }catch(error){return accessFailure(error);}
  }
  return {list:(request:Request)=>read(request),detail:(request:Request,id:string)=>read(request,id),packet:(request:Request,id:string)=>read(request,id,true)};
}
export const obligationReaders=createObligationReaders(operatorHandlers.guard,()=>loadExistingDemoState());
