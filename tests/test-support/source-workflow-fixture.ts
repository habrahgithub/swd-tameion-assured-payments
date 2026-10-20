import {describe,it,expect,vi} from 'vitest';
import {createSourceWorkflowHandlers} from '../../src/server/source-workflow';
import {DemoState,parseDemoStateSnapshot} from '../../src/server/demo-state';
import {contentHash} from '../../src/domain/linked-instruction';
import {DemoStateConflictError} from '../../src/server/supabase-demo-state-repository';
import type {AuthContext} from '../../src/server/operator-auth';
import type {OperatorSourceView} from '../../src/server/operator-source-records';

export function sourceHarness(){
  let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},[]).exportSnapshot(),revision=1;
  const source:OperatorSourceView={records:[],state_binding:{namespace:'synthetic-source-revisions',revision,authority_sha256:contentHash(snapshot.authority)},source_ingress:{schema_version:'SOURCE-INGRESS-1',operator_key:'SYNTHETIC-SOURCE-OWNER',credential_version:1,actor_id:snapshot.actor_authorities[0].actor_id,valid_from:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),permissions:['CREATE_SOURCE','CORRECT_SOURCE','REVIEW_SOURCE']}};
  const guard=vi.fn(async()=>({session:{operator_key:source.source_ingress!.operator_key,credential_version:1},revalidate:vi.fn(async()=>{})} as unknown as AuthContext));
  const repository={loadExisting:vi.fn(async()=>({revision,snapshot:structuredClone(snapshot) as unknown as Record<string,unknown>})),compareAndSet:vi.fn(async(_n:string,expected:number,next:Record<string,unknown>)=>{if(expected!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next) as unknown as typeof snapshot;return ++revision;})};
  const handler=createSourceWorkflowHandlers({guard,source:()=>source,repository:()=>repository});
  let n=1;const request=(body:unknown,key?:string)=>new Request('https://synthetic.invalid/api/obligations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key??`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`},body:JSON.stringify(body)});
  return {handler,source,repository,guard,request,snapshot:()=>snapshot};
}
export const invoice={kind:'INVOICE',supplier_name:'Synthetic supplier',invoice_number:'SYNTHETIC-INV-01',invoice_issue_date:'2026-10-20',payment_terms:'Due on receipt',due_date:'2026-10-20',description:'Synthetic test service',amount:'1.00',currency:'USD',payer_circle_wallet_id:'SYNTHETIC-UNVERIFIED-PAYER',evidence:[{evidence_id:'SYNTHETIC-EVIDENCE',content_sha256:'a'.repeat(64)}]} as const;
