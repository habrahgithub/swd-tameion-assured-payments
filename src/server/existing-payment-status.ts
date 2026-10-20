import {hashJ2aPreflightEvidence} from '../demo/real-testnet-payment';
import {verifyHistoricalPaeSignature} from '../pae/sign-verify';
import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {AccessError} from './route-access-policy';
import {loadFinancialSourceAdmissionForReconcile,type FinancialSourceAdmission} from './financial-source-admission';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';
import {parseDemoStateSnapshot,type DemoStateSnapshot} from './demo-state';
import {ArcCircleProviderAdapter,type ProviderAdapter} from '../execution/provider-adapter';
import {sameEvmAddressIdentity} from '../execution/evm-address';

interface Dependencies {guard:(r:Request,post:boolean)=>Promise<AuthContext>;source:()=>FinancialSourceAdmission;load:(namespace:string)=>Promise<DemoStateSnapshot>;adapter:(snapshot:DemoStateSnapshot,key:string)=>ProviderAdapter}
/** An explicit read capability observes an already recorded operation. It never
 * constructs an execution worker, creates a transfer, or commits settlement. */
export function createExistingPaymentStatusHandler(deps:Dependencies){return async(request:Request,id:string)=>{
 try{
  const auth=await deps.guard(request,false),source=deps.source(),fingerprint=JSON.stringify(source);
  if(id!==source.source.obligation_id)throw new AccessError('SOURCE_NOT_FOUND',404);
  await auth.revalidate();const snapshot=await deps.load(source.namespace),sealed=snapshot.sealed_paes.find(([target])=>target===id)?.[1]??snapshot.authorization_history.findLast(a=>a.approval_record.obligation_id===id)?.sealed_pae;
  const record=sealed?snapshot.execution_ledger.find(r=>r.idempotency_key===sealed.payload.idempotency_key):undefined;
  if(!sealed||!record)throw new AccessError('NO_RECORDED_EXECUTION',409);
  if(record.obligation_id!==id||sealed.payload.organization_id!==source.organization_id||sealed.payload.obligation_ids.length!==1||record.atomic_amount!==sealed.payload.atomic_amount||!sameEvmAddressIdentity(record.destination_address,sealed.payload.destination_address))throw new AccessError('IDENTITY_MISMATCH',409);
  const revalidate=async()=>{await auth.revalidate();if(JSON.stringify(deps.source())!==fingerprint)throw new AccessError('SOURCE_BINDING_CHANGED',403);};
  const adapter=deps.adapter(snapshot,record.idempotency_key),observation=record.provider_ref?await adapter.getStatus(record.provider_ref,record.idempotency_key,revalidate):await adapter.getStatusByIdempotencyKey?.(record.idempotency_key,revalidate)??{status:'UNKNOWN'};
  await revalidate();return privateJson({obligation_id:id,idempotency_key:record.idempotency_key,observation,posting_status:'NOT_COMMITTED_BY_THIS_READ',durable_execution_status:record.status,owner:'Treasury Operations',next_action:'AUTHORIZED_RECONCILIATION_REQUIRED'});
 }catch(error){return accessFailure(error);}
};}
export function recordedStatusPreflight(snapshot:DemoStateSnapshot,key:string){
 const pae=snapshot.authorization_history.find(a=>a.sealed_pae.payload.idempotency_key===key)?.sealed_pae;
 const proxy=snapshot.settlement_proxies?.find(p=>p.preflight.obligation_id===pae?.payload.obligation_ids[0])??snapshot.recovery_events?.find(e=>e.predecessor_key===key)?.predecessor_preflight;
 const signer=snapshot.trusted_keys.find(k=>k.signing_key_id===pae?.payload.signing_key_id&&k.signing_algorithm===pae.payload.signing_algorithm);
 if(!pae||!proxy||!signer||!pae.payload.evidence_hashes.includes(proxy.preflight.evidence_sha256)||hashJ2aPreflightEvidence(proxy.preflight as unknown as Record<string,unknown>)!==proxy.preflight.evidence_sha256||pae.payload.source_wallet_ref!==proxy.preflight.source_wallet.id||pae.payload.amount!==proxy.preflight.amount||!sameEvmAddressIdentity(pae.payload.destination_address,proxy.preflight.destination_wallet.address))return null;
 try{verifyHistoricalPaeSignature(pae,signer.public_key_spki_base64url);return proxy.preflight;}catch{return null;}
}
export const existingPaymentStatus=createExistingPaymentStatusHandler({guard:operatorHandlers.guard,source:loadFinancialSourceAdmissionForReconcile,load:async namespace=>{const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);return parseDemoStateSnapshot((await new SupabaseDemoStateRepository(url,key).loadExisting(namespace)).snapshot);},adapter:(snapshot,key)=>new ArcCircleProviderAdapter(undefined,requested=>requested===key?recordedStatusPreflight(snapshot,key):null)});
