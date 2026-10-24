import {createDiagnosticReadBudget,sourceWorkflowHandlers,type DiagnosticReadContext} from './source-workflow';
import {contentHash} from '../domain/linked-instruction';
import {paymentReleaseBindings} from '../domain/payment-release-approval';
import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {AccessError,methodNotAllowed} from './route-access-policy';
import {loadPublicSourceRecords,isCurrentSourceEligible} from './source-records';
import {loadOperatorSourceRecords,type OperatorSourceView,type OperatorStateBinding,type OwnerAdmissionState} from './operator-source-records';
import {loadOptionalFinancialSourceAdmission,loadFinancialRequesterBinding,loadFinancialRequesterBindingForReconcile,type FinancialSourceAdmission,type FinancialSourceAdmissionRead} from './financial-source-admission';
import {deterministicHistoricalContextValid,type LiveUsageObligationRecord} from '../agent/context-builder';
import {loadExistingDemoState,type ExistingState} from './load-existing-demo-state';
import {SupabaseDemoStateRepository,type RecoveryWorkflowCapabilities} from './supabase-demo-state-repository';
/** Descriptive fresh-command precondition only. Broad advisory eligibility also
 * supports current-result/link review and is deliberately left unchanged. */
function freshAssessmentReadiness(record:LiveUsageObligationRecord|undefined,admitted:boolean){
  const contextValid=Boolean(record?.assessment_basis&&deterministicHistoricalContextValid(record));
  return {ready:admitted&&contextValid,blocker:!admitted?'EXISTING_ASSESSMENT_ADMISSION_REQUIRED':contextValid?null:'SOURCE_ASSESSMENT_CONTEXT_REQUIRED'};
}
async function withLegacyAssessmentOverlay(response:Response,state:ExistingState|undefined,id:string,records:readonly LiveUsageObligationRecord[]):Promise<Response>{
  if(!state||!response.ok)return response;
  const data=await response.json(),visibility=state.getGenuineAssessmentVisibility?.(id);
  const staleChildReceipt=visibility?.disposition?.state==='USED'&&!visibility.disposition.child_current&&visibility.disposition.child_seal_hash!==undefined&&data.current_assessment?.assessment_hash===visibility.disposition.child_seal_hash;
  const unresolved=Boolean(visibility&&(['UNKNOWN','IN_PROGRESS'].includes(visibility.status)||staleChildReceipt));
  const prior=unresolved?state.store.getAssessmentHistory('ORG-DEMO-001',id).reverse().find(a=>a.record.source_record_sha256):undefined;
  const historical=prior?{obligation_id:id,assessment_id:prior.record.assessment_id,assessment_hash:prior.hash,aggregate_version:prior.record.aggregate_version,source_record_sha256:prior.record.source_record_sha256,decision:prior.record.decision,reasons:prior.record.reasons,provider_mode:prior.record.provider_mode}:null;
  const admitted=state.canAssessGenuine?.(id)===true;
  return privateJson({...data,...(visibility?{genuine_assessment:visibility}:{}),...(unresolved?{historical_assessment:historical,current_assessment:null,financial_action_eligible:false,truth:{...data.truth,tameion_control_truth:{...data.truth.tameion_control_truth,assessment_state:'NOT_ASSESSED'}}}:{}),fresh_assessment_readiness:freshAssessmentReadiness(records.find(record=>record.obligation_id===id),admitted),advisory_action_eligible:admitted,linked_testnet_instructions:state.getLinkedInstructions?.(id)??[]},response.status);
}
/** Explicit in-process seam for mock verification; runtime has no fixture mode. */
export function createObligationReaders(guard:(request:Request,post:boolean)=>Promise<AuthContext>,load:(records:readonly LiveUsageObligationRecord[],binding?:OperatorStateBinding,namespace?:string,ownerAdmission?:OwnerAdmissionState)=>Promise<ExistingState>,source:()=>readonly LiveUsageObligationRecord[]|OperatorSourceView=()=>loadOperatorSourceRecords()??loadPublicSourceRecords(),controlledSource:()=>FinancialSourceAdmission|undefined=()=>loadOptionalFinancialSourceAdmission(),workflowRead=sourceWorkflowHandlers,readCapabilities=async():Promise<RecoveryWorkflowCapabilities|null>=>{const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)return null;return new SupabaseDemoStateRepository(url,key).readRecoveryWorkflowCapabilities();}){
  async function read(request:Request,id?:string,packet=false,diagnostic=false){
    if(request.method!=='GET')return methodNotAllowed();
    let diagnosticBudget:DiagnosticReadContext['budget']|undefined;
    try {
      const auth=await guard(request,false),budget=diagnostic?createDiagnosticReadBudget(16):undefined,diagnosticReloads:Array<()=>Promise<ExistingState>>=[];diagnosticBudget=budget;
      const view=source();
      const versioned=!Array.isArray(view)&&Boolean((view as OperatorSourceView).source_ingress);
      const records:readonly LiveUsageObligationRecord[]=Array.isArray(view)?view:(view as OperatorSourceView).records;
      const binding=Array.isArray(view)?undefined:(view as OperatorSourceView).state_binding;
      const ownerAdmission=Array.isArray(view)?undefined:(view as OperatorSourceView).owner_admission;
      const controlled=controlledSource();
      if(versioned&&id!==undefined&&id!==controlled?.source.obligation_id&&!packet)return workflowRead('detail',request,id);
      const workflowContext:DiagnosticReadContext|undefined=diagnostic?{auth,budget:budget!}:undefined;
      const sourceResponse=diagnostic&&id===undefined?await workflowRead('diagnostic',request,undefined,workflowContext):versioned&&id===undefined?await workflowRead('list',request):undefined;
      if(sourceResponse&&!sourceResponse.ok){
        if(!diagnostic)return sourceResponse;
        const failure=await sourceResponse.clone().json().catch(()=>undefined);
        if(!failure?.diagnostic_meta)return sourceResponse;
        return privateJson({...failure,diagnostic_meta:{...failure.diagnostic_meta,binding_namespaces:[...budget!.revisions.keys()],read_count:budget!.count,revision_vector:[...budget!.revisions.entries()].map(([namespace,revision])=>({namespace,revision}))},obligations:[],allowed_actions:[]},sourceResponse.status);
      }
      const sourceCatalog=sourceResponse?await sourceResponse.json():undefined;
      if(controlled&&records.some(record=>record.obligation_id===controlled.source.obligation_id))throw new Error('OPERATOR_SOURCE_UNAVAILABLE');
      const sourceFingerprint=JSON.stringify([view,controlled]);
      await auth.revalidate();
      if(!diagnostic&&!versioned&&id===undefined&&records.length===0&&!controlled)return privateJson({obligations:[],assessed_count:0,total_count:0});
      const legacyEligible=id!==undefined&&binding===undefined&&!controlled&&isCurrentSourceEligible('ORG-DEMO-001',id);
      if(id!==undefined){
        const privateMember=records.some(record=>record.obligation_id===id);
        const controlledMember=controlled?.source.obligation_id===id;
        if((!privateMember&&!controlledMember&&!legacyEligible)||(packet&&!controlledMember&&!legacyEligible))return privateJson({error:'Obligation source record not found',code:'SRC-001'},404);
      }
      const controlledMember=id!==undefined&&controlled?.source.obligation_id===id;
      const boundedLoad=async(recordsToLoad:readonly LiveUsageObligationRecord[],bindingToLoad?:OperatorStateBinding,namespaceToLoad?:string,admissionToLoad?:OwnerAdmissionState,track=true)=>{
        if(budget){budget.count++;if(budget.count>budget.limit){budget.exceeded=true;throw new AccessError('DIAGNOSTIC_READ_LIMIT',503);}}
        let loaded:ExistingState;try{loaded=diagnostic||admissionToLoad!==undefined?await load(recordsToLoad,bindingToLoad,namespaceToLoad,admissionToLoad):namespaceToLoad!==undefined?await load(recordsToLoad,bindingToLoad,namespaceToLoad):await load(recordsToLoad,bindingToLoad);}catch(error){if(budget)budget.readUnavailable=true;throw error;}
        if(budget){if(typeof loaded.persistence_namespace!=='string'||typeof loaded.persistence_revision!=='number'||!Number.isSafeInteger(loaded.persistence_revision)){budget.readUnavailable=true;}else{const previous=budget.revisions.get(loaded.persistence_namespace);if(previous!==undefined&&previous!==loaded.persistence_revision)budget.revisionConflict=true;else budget.revisions.set(loaded.persistence_namespace,loaded.persistence_revision);}if(track)diagnosticReloads.push(()=>boundedLoad(recordsToLoad,bindingToLoad,namespaceToLoad,admissionToLoad,false));}
        return loaded;
      };
      const operatorState=!versioned&&(id===undefined||!controlledMember)?(records.length||legacyEligible?await boundedLoad(records,binding,undefined,ownerAdmission):undefined):undefined;
      const controlledState=controlled&&(id===undefined||controlledMember)?await boundedLoad([controlled.source],undefined,controlled.namespace):undefined;
      // An ACTUALLY expired controlled instruction is retained for read only when a recorded execution needs recovering; otherwise it stays hidden as before.
      const expiredControlled=Boolean(controlled&&(controlled as FinancialSourceAdmissionRead).authority_window==='EXPIRED');
      const retainedControlled=Boolean(controlled&&controlledState&&(!expiredControlled||controlledState.getCompleteExecutionRecords?.().some(record=>record.obligation_id===controlled.source.obligation_id)===true));
      await auth.revalidate();
      if(id!==undefined&&controlledMember&&!retainedControlled)return privateJson({error:'Obligation source record not found',code:'SRC-001'},404);
      if(JSON.stringify([source(),controlledSource()])!==sourceFingerprint)throw new Error("OPERATOR_SOURCE_UNAVAILABLE");
      let response:Response;
      const selectedState=controlledMember?controlledState:operatorState;
      if(packet){const sealed=selectedState!.getSealedPae(id!);if(!sealed)return privateJson({error:'No sealed PAE for this obligation.'},409);const {buildJ2PrimeApprovalPacket,renderJ2PrimeApprovalPacketText}=await import('../pipeline/prime-approval-packet');const value=buildJ2PrimeApprovalPacket(sealed);response=privateJson({packet:value,text:renderJ2PrimeApprovalPacketText(value)});}
      else if(id===undefined){const {projectObligationListData}=await import('./obligation-read-model');const operatorList=operatorState?projectObligationListData(operatorState,binding?"GENUINE_COMPANY":"UNVERIFIED",Boolean(binding?.workflow_base_sha256)):undefined;
        if(operatorList&&!versioned&&binding?.workflow_base_sha256)operatorList.obligations=operatorList.obligations.map(item=>({...item,fresh_assessment_readiness:freshAssessmentReadiness(records.find(record=>record.obligation_id===item.obligation_id),operatorState?.canAssessGenuine?.(item.obligation_id)===true)}));
        const parts=[...(operatorList?[operatorList]:[]),...(controlledState&&retainedControlled?[projectObligationListData(controlledState,"DEMO_ARC_TESTNET")]:[])];const obligations=[...(sourceCatalog?.obligations??[]),...parts.flatMap(part=>part.obligations)];response=privateJson({...(sourceCatalog?{allowed_actions:sourceCatalog.allowed_actions}:{}),obligations,assessed_count:obligations.filter(item=>item.assessed).length,total_count:obligations.length});
        if(diagnostic){
          const ids=new Set(["OBL-J0C-001","OBL-J0C-002","OBL-J0C-003","OBL-J0C-004","OBL-J0C-005","OBL-SWD-20261014-001"]);
          const diagnosticRows:Record<string,unknown>[]=[];
          for(const value of sourceCatalog?.obligations??[])if(value&&typeof value==="object"&&!Array.isArray(value)){const row=value as Record<string,unknown>;if(typeof row.obligation_id==="string"&&ids.has(row.obligation_id))diagnosticRows.push({...row,diagnostic_binding_namespace:binding?.namespace??null});}
          const projectRows=async(state:ExistingState|undefined,group:"GENUINE_COMPANY"|"UNVERIFIED"|"DEMO_ARC_TESTNET",ns:string|undefined,sourceBinding?:OperatorStateBinding)=>{
            if(!state)return;
            const {projectObligationDetail}=await import('./obligation-read-model');
            for(const obligation of state.listObligations())if(ids.has(obligation.obligation_id)){
              let detailResponse:Response=projectObligationDetail(state,obligation.obligation_id,false,undefined,group,sourceBinding?.workflow_base_sha256?contentHash(records.find(r=>r.obligation_id===obligation.obligation_id)):undefined);
              if(group==='GENUINE_COMPANY'&&sourceBinding?.workflow_base_sha256)detailResponse=await withLegacyAssessmentOverlay(detailResponse,state,obligation.obligation_id,records);
              const detail=await detailResponse.json() as Record<string,unknown>;
              diagnosticRows.push({...detail,obligation_id:obligation.obligation_id,diagnostic_binding_namespace:ns??state.persistence_namespace});
            }
          };
          await projectRows(operatorState,binding?"GENUINE_COMPANY":"UNVERIFIED",binding?.namespace??operatorState?.persistence_namespace,binding);
          await projectRows(controlledState,"DEMO_ARC_TESTNET",controlled?.namespace);
          let capabilities=versioned?(sourceCatalog?.capabilities??null):null;
          if(!versioned){
            budget!.count++;
            if(budget!.count>budget!.limit)budget!.exceeded=true;
            else try{capabilities=await readCapabilities();}catch{budget!.readUnavailable=true;}
          }
          if(budget!.exceeded||budget!.revisionConflict||budget!.readUnavailable)diagnosticRows.length=0;
          if(!budget!.exceeded)for(const reload of diagnosticReloads){try{await reload();}catch{budget!.readUnavailable=true;break;}if(budget!.exceeded)break;}
          await auth.revalidate();
          if(JSON.stringify([source(),controlledSource()])!==sourceFingerprint)throw new Error("DIAGNOSTIC_SOURCE_CHANGED");
          const paths:string[]=[];
          if(versioned)paths.push("RECOVERABLE_SOURCE_INGRESS");
          if(!versioned)paths.push(Array.isArray(view)?"PUBLIC_SOURCE":"LEGACY_ADVISORY");
          if(controlledState&&retainedControlled)paths.push("CONTROLLED_FINANCIAL");
          const uniquePaths=[...new Set(paths.length?paths:Array.isArray(view)?["PUBLIC_SOURCE"]:["NONE"])];
          const sourcePath=uniquePaths.length>1?"AMBIGUOUS":uniquePaths[0];
          const sourceReason=sourcePath==="AMBIGUOUS"?["SOURCE_PATH_AMBIGUOUS"]:sourcePath==="RECOVERABLE_SOURCE_INGRESS"?["RECOVERABLE_INGRESS_SELECTED"]:sourcePath==="LEGACY_ADVISORY"?["LEGACY_ADVISORY_SELECTED"]:sourcePath==="CONTROLLED_FINANCIAL"?["CONTROLLED_SOURCE_SELECTED"]:sourcePath==="PUBLIC_SOURCE"?["INGRESS_ABSENT"]:["SOURCE_DOCUMENT_UNAVAILABLE"];
          const observationStatus=budget!.exceeded||budget!.revisionConflict?"INCONSISTENT":budget!.readUnavailable||!budget!.revisions.size?"UNAVAILABLE":"CONSISTENT";
          const observationReason=budget!.exceeded?"READ_LIMIT_EXCEEDED":budget!.revisionConflict?"STATE_REVISION_CHANGED":budget!.readUnavailable?"STATE_READ_UNAVAILABLE":!budget!.revisions.size?"STATE_READ_UNAVAILABLE":null;
          const bindingNamespaces=new Set<string>(diagnosticRows.map(row=>row.diagnostic_binding_namespace).filter((value):value is string=>typeof value==="string"));
          for(const namespace of budget!.revisions.keys())bindingNamespaces.add(namespace);
          for(const entry of sourceCatalog?.diagnostic_meta?.revision_vector??[])if(entry&&typeof entry.namespace==="string")bindingNamespaces.add(entry.namespace);
          return privateJson({diagnostic_meta:{observation_status:observationStatus,observation_reason_code:observationReason,binding_namespaces:[...bindingNamespaces],source_path:sourcePath,source_reason_codes:sourceReason,read_count:budget!.count,revision_vector:[...budget!.revisions.entries()].map(([namespace,revision])=>({namespace,revision}))},capabilities,obligations:diagnosticRows,allowed_actions:[]});
        }
      }
      else {const {projectObligationDetail}=await import('./obligation-read-model');
        // An actually expired controlled instruction stays readable so its existing execution can be recovered, with no renewed financial eligibility.
        let bindings;try {if(controlledMember){const requester=expiredControlled?loadFinancialRequesterBindingForReconcile():loadFinancialRequesterBinding();if(requester.operator_key===auth.session.operator_key&&requester.credential_version===auth.session.credential_version)bindings=paymentReleaseBindings(controlled,requester);}}catch { /* readable, but no release capability */ }
        response=projectObligationDetail(selectedState!,id,(controlledMember&&!expiredControlled)||legacyEligible,auth.session?.operator_key&&typeof auth.session.credential_version==="number"?{...bindings,namespace:controlledMember?controlled!.namespace:binding?.namespace??process.env.TAMEION_STATE_NAMESPACE??"UNVERIFIED",operator_key:auth.session.operator_key,credential_version:auth.session.credential_version}:undefined,controlledMember?"DEMO_ARC_TESTNET":binding?"GENUINE_COMPANY":"UNVERIFIED",binding?.workflow_base_sha256?contentHash(records.find(r=>r.obligation_id===id)):undefined,controlledMember?{namespace:controlled!.namespace,selected_obligation_id:controlled!.source.obligation_id,selected_source_record_sha256:contentHash(controlled!.source),source_valid_until:controlled!.expires_at}:undefined,Boolean(controlledMember&&bindings));}
      if(!versioned&&id!==undefined&&!packet&&!controlledMember&&binding?.workflow_base_sha256&&response.ok){
        const data=await response.json();
        const visibility=selectedState?.getGenuineAssessmentVisibility?.(id);
        const staleChildReceipt=visibility?.disposition?.state==='USED'&&!visibility.disposition.child_current&&visibility.disposition.child_seal_hash!==undefined&&data.current_assessment?.assessment_hash===visibility.disposition.child_seal_hash;
        const unresolved=visibility&&(['UNKNOWN','IN_PROGRESS'].includes(visibility.status)||staleChildReceipt);
        const prior=unresolved?selectedState?.store.getAssessmentHistory('ORG-DEMO-001',id).reverse().find(a=>a.record.source_record_sha256):undefined;
        const historical=prior?{obligation_id:id,assessment_id:prior.record.assessment_id,assessment_hash:prior.hash,aggregate_version:prior.record.aggregate_version,source_record_sha256:prior.record.source_record_sha256,decision:prior.record.decision,reasons:prior.record.reasons,provider_mode:prior.record.provider_mode}:null;
        response=privateJson({...data,...(visibility?{genuine_assessment:visibility}:{}),...(unresolved?{historical_assessment:historical,current_assessment:null,financial_action_eligible:false,truth:{...data.truth,tameion_control_truth:{...data.truth.tameion_control_truth,assessment_state:"NOT_ASSESSED"}}}:{}),fresh_assessment_readiness:freshAssessmentReadiness(records.find(record=>record.obligation_id===id),selectedState?.canAssessGenuine?.(id)===true),advisory_action_eligible:selectedState?.canAssessGenuine?.(id)===true,linked_testnet_instructions:selectedState?.getLinkedInstructions?.(id)??[]},response.status);
      }
      response.headers.set('Cache-Control','no-store');return response;
    }catch(error){if(diagnostic){if(!diagnosticBudget||error instanceof AccessError&&(error.status===401||error.status===403))return accessFailure(error);const budgetStatus=error instanceof AccessError&&error.code==='DIAGNOSTIC_READ_LIMIT';const currentBudget=diagnosticBudget;return privateJson({diagnostic_meta:{observation_status:budgetStatus||currentBudget.revisionConflict?'INCONSISTENT':'UNAVAILABLE',observation_reason_code:budgetStatus?'READ_LIMIT_EXCEEDED':currentBudget.revisionConflict?'STATE_REVISION_CHANGED':'STATE_READ_UNAVAILABLE',binding_namespaces:[...currentBudget.revisions.keys()],read_count:currentBudget.count,revision_vector:[...currentBudget.revisions.entries()].map(([namespace,revision])=>({namespace,revision}))},capabilities:null,obligations:[],allowed_actions:[]},budgetStatus?200:503);}return accessFailure(error);}
  }
  return {list:(request:Request)=>read(request),detail:(request:Request,id:string)=>read(request,id),packet:(request:Request,id:string)=>read(request,id,true),diagnostic:(request:Request)=>read(request,undefined,false,true)};
}
export const obligationReaders=createObligationReaders(operatorHandlers.guard,(records,binding,namespace,ownerAdmission)=>loadExistingDemoState(undefined,namespace,records,binding,ownerAdmission));
