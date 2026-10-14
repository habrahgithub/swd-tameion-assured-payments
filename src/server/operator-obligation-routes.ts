import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {methodNotAllowed} from './route-access-policy';
import {loadPublicSourceRecords,isCurrentSourceEligible} from './source-records';
import {loadOperatorSourceRecords,type OperatorSourceView,type OperatorStateBinding} from './operator-source-records';
import {loadOptionalFinancialSourceAdmission,type FinancialSourceAdmission} from './financial-source-admission';
import type {LiveUsageObligationRecord} from '../agent/context-builder';
import {loadExistingDemoState,type ExistingState} from './load-existing-demo-state';
/** Explicit in-process seam for mock verification; runtime has no fixture mode. */
export function createObligationReaders(guard:(request:Request,post:boolean)=>Promise<AuthContext>,load:(records:readonly LiveUsageObligationRecord[],binding?:OperatorStateBinding,namespace?:string)=>Promise<ExistingState>,source:()=>readonly LiveUsageObligationRecord[]|OperatorSourceView=()=>loadOperatorSourceRecords()??loadPublicSourceRecords(),controlledSource:()=>FinancialSourceAdmission|undefined=()=>loadOptionalFinancialSourceAdmission()){
  async function read(request:Request,id?:string,packet=false){
    if(request.method!=='GET')return methodNotAllowed();
    try {
      const auth=await guard(request,false);
      const view=source();
      const records:readonly LiveUsageObligationRecord[]=Array.isArray(view)?view:(view as OperatorSourceView).records;
      const binding=Array.isArray(view)?undefined:(view as OperatorSourceView).state_binding;
      const controlled=controlledSource();
      if(controlled&&records.some(record=>record.obligation_id===controlled.source.obligation_id))throw new Error('OPERATOR_SOURCE_UNAVAILABLE');
      const sourceFingerprint=JSON.stringify([view,controlled]);
      await auth.revalidate();
      if(id===undefined&&records.length===0&&!controlled)return privateJson({obligations:[],assessed_count:0,total_count:0});
      const legacyEligible=id!==undefined&&binding===undefined&&!controlled&&isCurrentSourceEligible('ORG-DEMO-001',id);
      if(id!==undefined){
        const privateMember=records.some(record=>record.obligation_id===id);
        const controlledMember=controlled?.source.obligation_id===id;
        if((!privateMember&&!controlledMember&&!legacyEligible)||(packet&&!controlledMember&&!legacyEligible))return privateJson({error:'Obligation source record not found',code:'SRC-001'},404);
      }
      const controlledMember=id!==undefined&&controlled?.source.obligation_id===id;
      const operatorState=id===undefined||!controlledMember?(records.length||legacyEligible?await load(records,binding):undefined):undefined;
      const controlledState=controlled&&(id===undefined||controlledMember)?await load([controlled.source],undefined,controlled.namespace):undefined;
      await auth.revalidate();
      if(JSON.stringify([source(),controlledSource()])!==sourceFingerprint)throw new Error("OPERATOR_SOURCE_UNAVAILABLE");
      let response:Response;
      const selectedState=controlledMember?controlledState:operatorState;
      if(packet){const sealed=selectedState!.getSealedPae(id!);if(!sealed)return privateJson({error:'No sealed PAE for this obligation.'},409);const {buildJ2PrimeApprovalPacket,renderJ2PrimeApprovalPacketText}=await import('../pipeline/prime-approval-packet');const value=buildJ2PrimeApprovalPacket(sealed);response=privateJson({packet:value,text:renderJ2PrimeApprovalPacketText(value)});}
      else if(id===undefined){const {projectObligationListData}=await import('./obligation-read-model');const parts=[operatorState,controlledState].filter((state):state is ExistingState=>state!==undefined).map(projectObligationListData);const obligations=parts.flatMap(part=>part.obligations);response=privateJson({obligations,assessed_count:obligations.filter(item=>item.assessed).length,total_count:obligations.length});}
      else {const {projectObligationDetail}=await import('./obligation-read-model');response=projectObligationDetail(selectedState!,id,controlledMember||legacyEligible,auth.session?.operator_key&&typeof auth.session.credential_version==="number"?{namespace:controlledMember?controlled!.namespace:binding?.namespace??process.env.TAMEION_STATE_NAMESPACE??"UNVERIFIED",operator_key:auth.session.operator_key,credential_version:auth.session.credential_version}:undefined);}
      response.headers.set('Cache-Control','no-store');return response;
    }catch(error){return accessFailure(error);}
  }
  return {list:(request:Request)=>read(request),detail:(request:Request,id:string)=>read(request,id),packet:(request:Request,id:string)=>read(request,id,true)};
}
export const obligationReaders=createObligationReaders(operatorHandlers.guard,(records,binding,namespace)=>loadExistingDemoState(undefined,namespace,records,binding));
