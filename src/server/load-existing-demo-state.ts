import {createHash} from "node:crypto";
import {canonicalize} from "json-canonicalize";
import type {OperatorStateBinding} from "./operator-source-records";
import {AuthorityStore} from '../authority/aggregate';
import {TrustedKeyRegistry} from '../pae/keys';
import {sealedPaeSchema} from '../domain/schemas';
import {adaptDirectEvidenceObligation} from '../domain/payment-control-boundary';
import {loadPublicSourceRecords} from './source-records';
import {AccessError} from './route-access-policy';
import {runtimeRpc,type RpcClient} from './operator-auth-repository';
import type {DemoState,DemoStateSnapshot} from './demo-state';
import type {LiveUsageObligationRecord} from '../agent/context-builder';

export const DEMO_ORGANIZATION_ID='ORG-DEMO-001';
export const DEMO_ARC_TRUST_SIMULATED=true;
export type ExistingState=Pick<DemoState,'store'|'trustedKeys'|'listObligations'|'getRecord'|'getCanonicalObligation'|'getSealedPae'|'getSettlementProxy'|'getAuthorizationArtifacts'> & {worker:Pick<DemoState['worker'],'getExecutionRecord'>;providerAdapter:{name:string}};
/** Existing-state restoration only. No DemoState, worker, provider, signer,
 * actor seeding, migration, key generation or persistence constructor. */
export async function loadExistingDemoState(rpc:Pick<RpcClient,'call'>=runtimeRpc(),namespace=process.env.TAMEION_STATE_NAMESPACE,sourceRecords:readonly LiveUsageObligationRecord[]=loadPublicSourceRecords(),binding?:OperatorStateBinding):Promise<ExistingState> {
  if(!namespace||namespace.length>128)throw new AccessError('STATE_UNAVAILABLE',503);
  try {
    const result=await rpc.call('tameion_state_load_existing',{namespace,expected_schema_version:2});
    if(result.code||!Number.isSafeInteger(result.revision)||(result.revision as number)<1)throw new Error();
    const s=result.snapshot as DemoStateSnapshot;
    if(!s||s.schema_version!==2||s.actor_authority_registry_initialized!==true||!Array.isArray(s.actor_authorities)||!Array.isArray(s.trusted_keys)||!Array.isArray(s.execution_ledger)||!Array.isArray(s.sealed_paes)||!Array.isArray(s.authorization_history))throw new Error();
    if(binding&&(binding.namespace!==namespace||binding.revision!==result.revision||createHash("sha256").update(canonicalize(s.authority)).digest("hex")!==binding.authority_sha256))throw new Error();
    const store=AuthorityStore.fromSnapshot(s.authority),trustedKeys=new TrustedKeyRegistry();trustedKeys.restore(s.trusted_keys);
    const sealed=new Map(s.sealed_paes.map(([id,pae])=>[id,sealedPaeSchema.parse(pae)]));
    const records=structuredClone(sourceRecords);
    // A private VIEW cannot hydrate or seed missing authoritative aggregates.
    for(const record of records){const aggregate=store.get(DEMO_ORGANIZATION_ID,record.obligation_id);if(aggregate.source_amount!==record.amount||aggregate.source_currency!==record.currency)throw new Error();}
    return {store,trustedKeys,
      listObligations:()=>records.map(r=>({obligation_id:r.obligation_id,service_category:r.service_category,amount:r.amount,currency:r.currency,recurrence:r.recurrence,due_date:r.due_date,commercial_terms:r.commercial_terms})),
      getRecord:id=>records.find(r=>r.obligation_id===id),
      getCanonicalObligation:id=>{const r=records.find(r=>r.obligation_id===id);return r?adaptDirectEvidenceObligation(r):undefined;},
      getSealedPae:id=>sealed.get(id),getSettlementProxy:id=>s.settlement_proxies?.find(p=>p.preflight.obligation_id===id),
      getAuthorizationArtifacts:id=>[...s.authorization_history].reverse().find(a=>a.sealed_pae.payload.organization_id===DEMO_ORGANIZATION_ID&&a.sealed_pae.payload.obligation_ids.length===1&&a.sealed_pae.payload.obligation_ids[0]===id),
      worker:{getExecutionRecord:key=>s.execution_ledger.find(r=>r.idempotency_key===key)},
      // Match financial-runtime transport selection without constructing it.
      // This metadata does not grant release authority or prove settlement.
      providerAdapter:{name:process.env.CIRCLE_API_KEY&&process.env.CIRCLE_ENTITY_SECRET?'arc-circle-live':'fake-testnet'},
    };
  }catch{throw new AccessError('STATE_UNAVAILABLE',503);}
}
