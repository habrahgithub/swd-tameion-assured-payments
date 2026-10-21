'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {SourceFields,SourceRevision} from '../src/domain/source-revision';
import type {SealedReviewDecision} from '../src/domain/review-decision';

export type SourceWorkflowView={review_decision_history?:SealedReviewDecision[];source_revision_history?:SourceRevision[];current_assessment?:{provider_mode:string}|null;review_findings?:{code:string;reason:string;advisory:boolean}[];allowed_actions?:string[];aggregate?:{aggregate_version:number};record?:{obligation_id:string;source_evidence:{evidence_id:string}[]};source_revision?:{revision:number;fields:SourceFields};current_review_decision?:SealedReviewDecision|null;blockers?:{code:string;owner:string;remedy:string}[];sealed_pae_instruction_hash?:string;sealed_pae_idempotency_key?:string;execution?:{idempotency_key:string}};
const empty:Record<string,string>={kind:'INVOICE',supplier_name:'',invoice_number:'',invoice_issue_date:'',payment_terms:'',due_date:'',description:'',amount:'',currency:'USD',payer_circle_wallet_id:'',service_reference:'',purpose:'',service_date:'',evidence_id:'',content_sha256:'',reason:''};
const labels:Record<string,string>={supplier_name:'Supplier name',invoice_number:'Invoice number',invoice_issue_date:'Invoice issue date',payment_terms:'Payment terms',due_date:'Due date',description:'Description',amount:'Exact amount',currency:'Source currency',payer_circle_wallet_id:'Payer Circle Wallet ID',service_reference:'Service reference',purpose:'Recharge purpose',service_date:'Service date',evidence_id:'Evidence reference',content_sha256:'Evidence SHA256',reason:'Correction or entry reason'};
type PendingCommand={signature:string;key:string};
type RetainedPanel={version:2;scope:string;hasSourceDraft:boolean;draft:Record<string,string>;retainedEvidence:{evidence_id:string;content_sha256:string}[];rationale:string;escalationOwner:string;reviewMode:string;acceptedFindings:string[];request:PendingCommand|null};
function commandTransport(pending:PendingCommand,target:string){
 try{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pending.key)||pending.signature.length>65536)return null;
  const transport=JSON.parse(pending.signature),root=`/api/obligations/${encodeURIComponent(target)}`;
  if(!transport.body||Array.isArray(transport.body)||typeof transport.body!=='object')return null;
  const allowed=target==='new'?transport.path==='/api/obligations'&&transport.method==='POST':
   transport.method==='PATCH'&&transport.path===root||transport.method==='POST'&&(['review','advisory','testnet-instruction','approve','successor','reconcile'].some(action=>transport.path===`${root}/${action}`)||transport.path==='/api/internal/demo/real-testnet-payment/preflight'&&transport.body.obligation_id===target);
  return allowed&&JSON.stringify({path:transport.path,body:transport.body,method:transport.method})===pending.signature?transport as {path:string;body:Record<string,unknown>;method:string}:null;
 }catch{return null;}
}
function retainedPanel(scope:string,target:string,serialized?:string):RetainedPanel|null {
 try{
  const raw=serialized??sessionStorage.getItem(scope);if(!raw||raw.length>100000)return null;
  const saved=JSON.parse(raw);
  if(saved?.version!==2||saved.scope!==scope||typeof saved.hasSourceDraft!=='boolean'||!saved.draft||Object.keys(empty).some(k=>typeof saved.draft[k]!=='string'||saved.draft[k].length>4096)||!['INVOICE','PREPAID_RECHARGE'].includes(saved.draft.kind)||!Array.isArray(saved.retainedEvidence)||saved.retainedEvidence.length>16||saved.retainedEvidence.some((e:{evidence_id?:unknown;content_sha256?:unknown})=>!e||typeof e.evidence_id!=='string'||e.evidence_id.length>512||typeof e.content_sha256!=='string'||e.content_sha256.length>64))return null;
  if(typeof saved.rationale!=='string'||saved.rationale.length>1024||typeof saved.escalationOwner!=='string'||saved.escalationOwner.length>512||!['MANUAL_REVIEW','AI_EXCEPTION_REVIEW','AI_ASSISTED_REVIEW'].includes(saved.reviewMode)||!Array.isArray(saved.acceptedFindings)||saved.acceptedFindings.length>64||saved.acceptedFindings.some((code:unknown)=>typeof code!=='string'||code.length>128)||saved.request!==null&&(!saved.request||typeof saved.request.signature!=='string'||typeof saved.request.key!=='string'||!commandTransport(saved.request,target)))return null;
  return saved;
 }catch{return null;}
}
function preflightRefusalMessage(path:string,status:number,data:unknown):string|null {
 if(path!=='/api/internal/demo/real-testnet-payment/preflight'||status!==409||!data||typeof data!=='object'||Array.isArray(data))return null;
 const result=data as Record<string,unknown>;
 // Only canonical read-only refusals receive guidance. Extra execution/outcome
 // fields, retry hints and other codes keep the existing conservative response.
 if(Object.keys(result).some(key=>!['readiness','blocker','captured_at','code','aggregate_version','authority_preserved','error'].includes(key))||result.readiness!=='BLOCKED'||
  'code' in result&&result.code!=='READINESS_REFRESHED'||'authority_preserved' in result&&result.authority_preserved!==true||
  'aggregate_version' in result&&(!Number.isSafeInteger(result.aggregate_version)||(result.aggregate_version as number)<1)||
  'captured_at' in result&&(typeof result.captured_at!=='string'||!Number.isFinite(Date.parse(result.captured_at)))||'error' in result&&typeof result.error!=='string')return null;
 if(result.blocker==='INSUFFICIENT_BALANCE')return 'INSUFFICIENT_BALANCE. The current balance does not cover the approved payment total and network fee. Use the approved funding process, then refresh current payment readiness before proceeding. This read-only check did not submit a payment.';
 if(result.blocker==='FEE_CAP_EXCEEDED')return 'FEE_CAP_EXCEEDED. The current network fee quote exceeds the approved fee cap. Obtain a compliant current quote or renewed approved terms, then refresh current payment readiness and review the exact payment details before proceeding. This check does not increase the fee cap or submit payment.';
 return null;
}
/** Same authenticated commands as direct API clients. Capabilities come from the
 * server; form presence never establishes financial readiness or wallet control. */
export function SourceWorkflowPanel({selectedId,csrfToken,onChanged,readModel}:{selectedId:string;csrfToken:string;onChanged:()=>void;readModel?:{detail:SourceWorkflowView|null;createAllowed:boolean}}){
 const [retainedEvidence,setRetainedEvidence]=useState<{evidence_id:string;content_sha256:string}[]>([]),[view,setView]=useState<SourceWorkflowView|null>(null),[createAllowed,setCreateAllowed]=useState(false),[editing,setEditing]=useState(false),[creating,setCreating]=useState(false),[draft,setDraft]=useState(empty),[rationale,setRationale]=useState(''),[escalationOwner,setEscalationOwner]=useState(''),[reviewMode,setReviewMode]=useState('MANUAL_REVIEW'),[acceptedFindings,setAcceptedFindings]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0),request=useRef<PendingCommand|null>(null),lifetime=useRef(true);
 const [pending,setPending]=useState<PendingCommand|null>(null);
 const keyFor=(target:string)=>`tameion.source-draft.v2.${encodeURIComponent(csrfToken)}.${encodeURIComponent(target)}`;
 const storageKey=keyFor(creating?'new':selectedId);
 function restore(saved:RetainedPanel|null){
  request.current=saved?.request??null;setPending(saved?.request??null);setDraft(saved?.draft??{...empty});setRetainedEvidence(saved?.retainedEvidence??[]);setRationale(saved?.rationale??'');setEscalationOwner(saved?.escalationOwner??'');setReviewMode(saved?.reviewMode??'MANUAL_REVIEW');setAcceptedFindings(saved?.acceptedFindings??[]);
 }
 function persist(overrides:Partial<RetainedPanel>={}){
  try{const serialized=JSON.stringify({version:2,scope:storageKey,hasSourceDraft:editing,draft,retainedEvidence,rationale,escalationOwner,reviewMode,acceptedFindings,request:request.current,...overrides});if(!retainedPanel(storageKey,creating?'new':selectedId,serialized))return false;sessionStorage.setItem(storageKey,serialized);return true;}catch{return false;}
 }
 function reviewInput(field:'rationale'|'escalationOwner'|'reviewMode'|'acceptedFindings',value:string|string[]){
  if(field==='rationale')setRationale(value as string);else if(field==='escalationOwner')setEscalationOwner(value as string);else if(field==='reviewMode')setReviewMode(value as string);else setAcceptedFindings(value as string[]);
  persist({[field]:value});
 }
 useEffect(()=>{lifetime.current=true;return()=>{lifetime.current=false;generation.current++;};},[]);
 useEffect(()=>{
  const owned=++generation.current;setView(null);setEditing(false);setCreating(false);setBusy(false);setMessage('');setRationale('');setEscalationOwner('');setReviewMode('MANUAL_REVIEW');setAcceptedFindings([]);restore(retainedPanel(keyFor(selectedId),selectedId));
  if(readModel){setCreateAllowed(readModel.createAllowed);setView(readModel.detail?.record?.obligation_id===selectedId?readModel.detail:null);return;}
  void(async()=>{try{const list=await fetch('/api/obligations',{cache:'no-store'});const data=await list.json();if(owned!==generation.current)return;setCreateAllowed(list.ok&&data.allowed_actions?.includes('CREATE_SOURCE')===true);
   if(selectedId){const response=await fetch(`/api/obligations/${encodeURIComponent(selectedId)}`,{cache:'no-store'});const detail=await response.json();if(owned===generation.current&&response.ok)setView(detail);}
  }catch{if(owned===generation.current)setMessage('Current source status is unavailable. Refresh to read committed state.');}})();
 },[selectedId,csrfToken]);
 useEffect(()=>{if(readModel){setCreateAllowed(readModel.createAllowed);setView(readModel.detail?.record?.obligation_id===selectedId?readModel.detail:null);}},[readModel?.detail,readModel?.createAllowed,selectedId]);
 const actions=view?.allowed_actions??[];
 async function command(path:string,body:unknown,method='POST'){
  const owned=generation.current,original=request.current?commandTransport(request.current,creating?'new':selectedId):null;
  // Repeating unchanged review input recovers the pending receipt even when a
  // refresh supplied newer concurrency tokens. Changed human input gets a new key.
  if(original&&original.path===path&&original.method===method&&path.endsWith('/review')){
   const input=(value:unknown)=>JSON.stringify(Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!['expected_version','expected_review_hash'].includes(key))));
   if(input(original.body)===input(body))body=original.body;
  }
  const signature=JSON.stringify({path,body,method});
  if(request.current?.signature!==signature)request.current={signature,key:crypto.randomUUID()};
  const key=request.current.key;setPending(request.current);if(!persist()){setMessage('Pending command could not be retained. Enable tab storage before submitting.');return;}setBusy(true);setMessage('Saving; awaiting committed readback.');
  try{const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Tameion-CSRF':csrfToken,'Idempotency-Key':key},body:JSON.stringify(body)}),data=await response.json();
   if(!lifetime.current||owned!==generation.current)return;
   if(!response.ok){setMessage(preflightRefusalMessage(path,response.status,data)??`${data.code??'COMMAND_UNVERIFIED'}. ${data.remedy??'Read current status before trying another action.'}`);return;}
   setMessage(data.replayed?'Original review receipt recovered (historical only; no current authorization restored).':data.committed?'Source revision saved and read back.':'Command recorded. Refreshing committed status.');setEditing(false);request.current=null;setPending(null);try{sessionStorage.removeItem(storageKey);}catch{/* No new browser authority. */}onChanged();
   if(selectedId&&!readModel){const read=await fetch(`/api/obligations/${encodeURIComponent(selectedId)}`,{cache:'no-store'});const current=await read.json();if(read.ok&&owned===generation.current)setView(current);}
  }catch{if(owned===generation.current)setMessage('Acknowledgement unavailable. Refresh committed status; the original request identity is retained.');}
  finally{if(lifetime.current&&owned===generation.current)setBusy(false);}
 }
 async function observe(){
  const owned=generation.current;setBusy(true);
  try{const response=await fetch(`/api/obligations/${encodeURIComponent(selectedId)}/payment-status`,{cache:'no-store'}),data=await response.json();if(!lifetime.current||owned!==generation.current)return;setMessage(response.ok?`Provider observation: ${data.observation?.outcome??data.observation?.status}. Settlement posting requires authorized reconciliation.`:`${data.code??'STATUS_UNVERIFIED'}. Current status is unverified.`);}
  catch{if(lifetime.current&&owned===generation.current)setMessage('Provider status unavailable; original operation retained.');}
  finally{if(lifetime.current&&owned===generation.current)setBusy(false);}
 }
 function begin(create:boolean){setCreating(create);let next={...empty},evidence=create?[]:view?.source_revision?.fields.evidence??[];if(!create&&view?.source_revision){const f=view.source_revision.fields;next={...empty,...Object.fromEntries(Object.entries(f).filter(([,v])=>typeof v==='string')),evidence_id:f.evidence[0].evidence_id,content_sha256:f.evidence[0].content_sha256};}
  const target=create?'new':selectedId,saved=retainedPanel(keyFor(target),target);
  if(saved){if(saved.hasSourceDraft){next=saved.draft;evidence=saved.retainedEvidence;}request.current=saved.request;setPending(saved.request);}else{request.current=null;setPending(null);}
  setDraft(next);setRetainedEvidence(evidence);setEditing(true);
 }
 function update(field:string,value:string){const next={...draft,[field]:value};setDraft(next);persist({draft:next});}
 function replaceEvidence(next:{evidence_id:string;content_sha256:string}[]){setRetainedEvidence(next);persist({retainedEvidence:next});}
 function addEvidence(){if(retainedEvidence.length>=16)return;replaceEvidence([...(retainedEvidence.length?retainedEvidence:[{evidence_id:draft.evidence_id,content_sha256:draft.content_sha256}]),{evidence_id:'',content_sha256:''}]);}
 function save(event:FormEvent){event.preventDefault();const fields={supplier_name:draft.supplier_name,description:draft.description,amount:draft.amount,currency:draft.currency,payer_circle_wallet_id:draft.payer_circle_wallet_id,evidence:[{evidence_id:draft.evidence_id,content_sha256:draft.content_sha256},...retainedEvidence.slice(1)],...(draft.kind==='INVOICE'?{kind:'INVOICE',invoice_number:draft.invoice_number,invoice_issue_date:draft.invoice_issue_date,payment_terms:draft.payment_terms,due_date:draft.due_date}:{kind:'PREPAID_RECHARGE',service_reference:draft.service_reference,purpose:draft.purpose,service_date:draft.service_date})};
  if(request.current){try{const original=JSON.parse(request.current.signature);if(JSON.stringify(original.body.fields)===JSON.stringify(fields)&&original.body.reason===draft.reason){void command(original.path,original.body,original.method);return;}}catch{/* Invalid browser receipts grant no authority. */}}
  void command(creating?'/api/obligations':`/api/obligations/${encodeURIComponent(selectedId)}`,{expected_revision:creating?0:view?.source_revision?.revision??0,...(!creating?{expected_version:view?.aggregate?.aggregate_version}:{}),fields,reason:draft.reason},creating?'POST':'PATCH');
 }
 function review(decision:string){if(!view?.aggregate||!view.record)return;void command(`/api/obligations/${encodeURIComponent(selectedId)}/review`,{expected_version:view.aggregate.aggregate_version,...(view.current_review_decision?{expected_review_hash:view.current_review_decision.hash}:{}),mode:reviewMode,decision,...(decision==='ESCALATE'&&escalationOwner.trim()?{escalation_owner_actor_id:escalationOwner.trim()}:{}),rationale,evidence_ids:view.record.source_evidence.map(e=>e.evidence_id),finding_dispositions:acceptedFindings.map(code=>({finding_code:code,disposition:'ACCEPT_ADVISORY',rationale,evidence_ids:view.record!.source_evidence.map(e=>e.evidence_id)}))});}
 const transport=pending?commandTransport(pending,creating?'new':selectedId):null;
 const pendingAction=transport?.path.endsWith('/review')?'MANUAL_REVIEW':transport?.path.endsWith('/successor')?'PREPARE_SUCCESSOR':transport?.path.endsWith('/reconcile')?'RECOVER_EXISTING_PAYMENT':transport?.path.endsWith('/advisory')?'REQUEST_AI_ADVICE':transport?.path.endsWith('/testnet-instruction')?'PREPARE_CONTROLLED_INSTRUCTION':transport?.path.endsWith('/approve')?'AUTHORIZE_PAYMENT':transport?.path.endsWith('/preflight')?'REFRESH_READINESS':'EDIT_SOURCE';
 const receiptVisible=pendingAction==='MANUAL_REVIEW'&&actions.length>0&&view?.review_decision_history?.some(review=>review.record.request_id===pending?.key);
 const canRecover=Boolean(transport&&view?.record?.obligation_id===selectedId&&(actions.includes(pendingAction)||receiptVisible));
 if(!createAllowed&&!actions.length&&!editing&&!view?.current_review_decision&&!view?.source_revision)return null;
 const fields=['supplier_name',...(draft.kind==='INVOICE'?['invoice_number','invoice_issue_date','payment_terms','due_date']:['service_reference','purpose','service_date']),'description','amount','currency','payer_circle_wallet_id','evidence_id','content_sha256','reason'];
 return <section id="payable-source-review" tabIndex={-1} aria-label="Payable source and human review" className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
  <h2 className="font-semibold">Source and review</h2>
  {Boolean(view?.source_revision_history?.length)&&<details className="rounded border p-2 text-sm"><summary>Saved source versions</summary>{view!.source_revision_history!.map(row=><article key={row.revision} className="mt-3 space-y-1 break-words"><p>Revision {row.revision} · {row.activation==='CURRENT'?'Recorded current revision at save':'Draft pending original payment recovery'}</p><p>{row.created_at} · {row.reason}</p><dl>{Object.entries(row.fields).filter(([,value])=>typeof value==='string').map(([field,value])=><div key={field} className="min-w-0"><dt className="font-medium">{labels[field]??field}</dt><dd className="break-words">{String(value)}</dd></div>)}</dl><p>Evidence: {row.fields.evidence.map(e=>e.evidence_id).join(', ')}. Entered facts and payer control remain unverified.</p></article>)}</details>}
  <div className="flex flex-wrap gap-3">{createAllowed&&<button type="button" disabled={busy} onClick={()=>begin(true)}>Create payable</button>}{actions.includes('EDIT_SOURCE')&&<button type="button" disabled={busy} onClick={()=>begin(false)}>Edit payable / Save correction</button>}</div>
  {editing&&<form onSubmit={save} className="grid gap-3 sm:grid-cols-2"><label>Source type<select value={draft.kind} onChange={e=>update('kind',e.target.value)}><option value="INVOICE">Invoice</option><option value="PREPAID_RECHARGE">Prepaid recharge</option></select></label>{fields.map(field=><label key={field} className="flex min-w-0 flex-col gap-1 text-sm">{labels[field]}<input required value={draft[field]} type={field.includes('date')?'date':'text'} inputMode={field==='amount'?'decimal':undefined} onChange={e=>update(field,e.target.value)} className="min-w-0 rounded border p-2 text-[var(--color-ink)] bg-[var(--color-surface)]"/></label>)}<div className="space-y-2 sm:col-span-2">{retainedEvidence.slice(1).map((e,index)=><div key={index} className="grid gap-2 sm:grid-cols-2"><label className="min-w-0">Evidence reference {index+2}<input required value={e.evidence_id} onChange={event=>replaceEvidence(retainedEvidence.map((item,i)=>i===index+1?{...item,evidence_id:event.target.value}:item))} className="w-full min-w-0 rounded border p-2 bg-[var(--color-surface)]"/></label><label className="min-w-0">Evidence SHA256 {index+2}<input required value={e.content_sha256} onChange={event=>replaceEvidence(retainedEvidence.map((item,i)=>i===index+1?{...item,content_sha256:event.target.value}:item))} className="w-full min-w-0 rounded border p-2 bg-[var(--color-surface)]"/></label><button type="button" disabled={busy} onClick={()=>replaceEvidence(retainedEvidence.filter((_,i)=>i!==index+1))}>Remove evidence reference {index+2}</button></div>)}<button type="button" disabled={busy||retainedEvidence.length>=16} onClick={addEvidence}>Add evidence reference</button></div><p className="text-sm sm:col-span-2">Use an existing evidence reference. Saving records entered facts; payer control and the receiving destination require independent verification.</p><button disabled={busy} type="submit">{creating?'Save payable':'Save correction'}</button><button type="button" onClick={()=>setEditing(false)}>Close draft</button></form>}
  {actions.includes('REQUEST_AI_ADVICE')&&<button disabled={busy} onClick={()=>void command(`/api/obligations/${encodeURIComponent(selectedId)}/advisory`,{})}>Request AI advice</button>}
  {actions.includes('MANUAL_REVIEW')&&<div className="space-y-2"><label>Review mode<select value={reviewMode} onChange={e=>reviewInput('reviewMode',e.target.value)}><option value="MANUAL_REVIEW">Manual review</option><option value="AI_EXCEPTION_REVIEW">AI exception review</option><option value="AI_ASSISTED_REVIEW" disabled={view?.current_assessment?.provider_mode!=="LIVE_AI"}>AI-assisted review of returned advice</option></select></label><label className="flex flex-col">Escalation owner (blank assigns current authorized operator)<input value={escalationOwner} onChange={e=>reviewInput('escalationOwner',e.target.value)}/></label><label className="flex flex-col">Review rationale<textarea value={rationale} maxLength={1024} onChange={e=>reviewInput('rationale',e.target.value)} className="rounded border p-2 bg-[var(--color-surface)]"/></label>{view?.review_findings?.map(f=><div key={f.code}><p>{f.code}: {f.reason}</p>{f.advisory?<label><input type="checkbox" checked={acceptedFindings.includes(f.code)} onChange={e=>reviewInput('acceptedFindings',e.target.checked?[...acceptedFindings,f.code]:acceptedFindings.filter(code=>code!==f.code))}/> Accept this advisory finding with the rationale and cited evidence</label>:<p>Correct the actual source or required verification before acceptance.</p>}</div>)}<div className="flex flex-wrap gap-3"><button disabled={busy||!rationale.trim()} onClick={()=>review('ACCEPT_FOR_AUTHORIZATION')}>Continue with manual review</button><button disabled={busy||!rationale.trim()} onClick={()=>review('ESCALATE')}>Assign escalation</button><button disabled={busy||!rationale.trim()} onClick={()=>review('NEEDS_CORRECTION')}>Request correction</button><button disabled={busy||!rationale.trim()} onClick={()=>review('DECLINE')}>Reject</button></div></div>}
  {view?.current_review_decision&&<p>Human review: {view.current_review_decision.record.decision} · {view.current_review_decision.record.mode}. AI attempts remain historical.</p>}
  {Boolean(view?.review_decision_history?.length)&&<details className="rounded border p-2 text-sm"><summary>Human review history</summary>{view!.review_decision_history!.map(review=><article key={review.hash} className="mt-3 space-y-1 break-words"><p>{review.record.decision} · {review.record.mode}</p><p>{review.record.actor_id} · {review.record.created_at}</p><p>{review.record.rationale}</p>{review.record.escalation_owner_actor_id&&<p>Assigned owner: {review.record.escalation_owner_actor_id}</p>}<p>Evidence: {review.record.evidence_ids.join(', ')}</p>{review.record.finding_dispositions.map(d=><p key={d.finding_code}>{d.finding_code}: {d.disposition} · {d.rationale}</p>)}<p className="break-all">Review reference: {review.record.decision_id} · {review.hash}</p>{review.record.supersedes_review_hash&&<p className="break-all">Resolves prior review: {review.record.supersedes_review_hash}</p>}</article>)}</details>}
  {actions.includes('PREPARE_CONTROLLED_INSTRUCTION')&&view?.current_review_decision&&<button disabled={busy} onClick={()=>void command(`/api/obligations/${encodeURIComponent(selectedId)}/testnet-instruction`,{expected_version:view.aggregate?.aggregate_version,review_decision_id:view.current_review_decision!.record.decision_id,review_decision_hash:view.current_review_decision!.hash})}>Prepare linked testnet instruction</button>}
  {actions.includes('REFRESH_READINESS')&&<button disabled={busy} onClick={()=>void command('/api/internal/demo/real-testnet-payment/preflight',{obligation_id:selectedId,expected_version:view?.aggregate?.aggregate_version})}>Refresh payment readiness</button>}
  {actions.includes('AUTHORIZE_PAYMENT')&&view?.current_review_decision&&<button disabled={busy} onClick={()=>void command(`/api/obligations/${encodeURIComponent(selectedId)}/approve`,{expected_version:view.aggregate?.aggregate_version,reviewed_decision_id:view.current_review_decision!.record.decision_id,reviewed_decision_hash:view.current_review_decision!.hash,reason_text:rationale||'Exact controlled payment instruction and current human decision reviewed.'})}>Authorize exact payment</button>}
  {actions.includes('PREPARE_SUCCESSOR')&&<label className="flex flex-col">Recovery rationale<textarea maxLength={1024} value={rationale} onChange={e=>reviewInput('rationale',e.target.value)} className="rounded border p-2 bg-[var(--color-surface)]"/></label>}
  {actions.includes('PREPARE_SUCCESSOR')&&<button disabled={busy||!rationale.trim()} onClick={()=>void command(`/api/obligations/${encodeURIComponent(selectedId)}/successor`,{expected_version:view?.aggregate?.aggregate_version,predecessor_key:view?.execution?.idempotency_key??view?.sealed_pae_idempotency_key,reason:rationale})}>Prepare evidence-supported successor</button>}
  {actions.includes('OBSERVE_EXISTING_PAYMENT')&&<button disabled={busy} onClick={()=>void observe()}>Observe existing payment status</button>}
  {actions.includes('RECOVER_EXISTING_PAYMENT')&&<button disabled={busy} onClick={()=>void command(`/api/obligations/${encodeURIComponent(selectedId)}/reconcile`,{idempotency_key:view?.execution?.idempotency_key,pae_instruction_hash:view?.sealed_pae_instruction_hash})}>Recover existing payment</button>}
  {view?.blockers?.map(b=><p key={b.code}>{b.code} · {b.owner}: {b.remedy}</p>)}
  {pending&&!editing&&<p>Pending command retained for this session and payable. Read current status before retrying; browser storage grants no permission.</p>}
  {pending&&!editing&&canRecover&&<button disabled={busy} onClick={()=>{if(transport)void command(transport.path,transport.body,transport.method);}}>Recover original pending command</button>}
  {message&&<p role="status" aria-live="polite">{message}</p>}
 </section>;
}
