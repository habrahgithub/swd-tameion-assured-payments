import type {DemoStateSnapshot} from './demo-state';
/** Advisory capability must never reopen an existing financial/recovery identity. */
export function genuineHasFinancialHistory(snapshot:DemoStateSnapshot,id:string){
 const a=snapshot.authority.aggregates.find(r=>r.organization_id==='ORG-DEMO-001'&&r.obligation_id===id);
 return !a||a.state==='AUTHORIZED'||a.state==='CANCELLED'||a.execution_state!=='NONE'||a.execution_idempotency_key!==null||a.pae_state!=='UNUSED'||snapshot.sealed_paes.some(([key])=>key===id)||snapshot.authorization_history.some(h=>h.approval_record.obligation_id===id)||snapshot.execution_ledger.some(e=>e.obligation_id===id);
}
