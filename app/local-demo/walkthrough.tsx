"use client";

import { useEffect, useRef, useState } from "react";
import { openLocalWalkthrough, SCENARIOS, SYNTHETIC_NOTICE, type Scenario, type WalkthroughView } from "../../src/demo/local-walkthrough";

type Journey = ReturnType<typeof openLocalWalkthrough>;
const button="rounded border border-[var(--color-border-strong)] bg-white px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50";
const card="min-w-0 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:p-6";
function guidance(v:WalkthroughView):string {
  if(v.stage==="UNKNOWN")return "OUTCOME_UNVERIFIED / NO RETRY. Observe recorded fake evidence only; do not resubmit.";
  if(v.stage==="RECONCILED_MOCK")return "Mock confirmation recorded. Review the audit trail or select the other invented case. No vendor payment occurred.";
  if(v.stage==="SUBMITTED_MOCK")return "Fake submission recorded. Observe the recorded fake outcome to reconcile; no second submission is available.";
  if(v.stage==="BLOCKED")return "Mock send blocked before submission. Review current eligibility and exact packet binding. No external effect occurred.";
  if(v.packet&&v.packet.intent.version!==v.version)return "Inputs changed. The previous mock packet is historical only and cannot execute. Assess the current version.";
  if(v.stage==="ASSURED_MOCK")return "Review the unsigned mock packet, then submit only to the in-memory fake adapter. This is not production assurance.";
  if(v.assessment?.decision==="HOLD")return "HOLD: invented evidence is incomplete. The mock evidence owner must resolve it; authorization is blocked.";
  if(v.assessment?.decision==="ESCALATE")return "ESCALATE: an invented policy exception needs independent review; authorization is blocked.";
  if(v.assessment&&!v.fundingEligible)return "Funding hold: advisory PAY does not establish funding eligibility. Mock authorization is blocked.";
  if(v.assessment)return "PAY is advisory. Acknowledge the exact current mock case, version and assessment; no real identity is verified.";
  return "Assess this invented case using deterministic local rules. No AI, database or provider call will occur.";
}
export function LocalWalkthrough() {
  const model=useRef<Journey|null>(null);
  const [view,setView]=useState<WalkthroughView|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [blocked,setBlocked]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{try{model.current=openLocalWalkthrough();setView(model.current.view());}catch(e){setBlocked(true);setError(String(e));}},[]);
  async function act(action:(j:Journey)=>WalkthroughView|Promise<WalkthroughView>) {
    if(!model.current||busy)return;setBusy(true);setError(null);
    try{setView(await action(model.current));}catch(e){setError(e instanceof Error?e.message:String(e));try{setView(model.current.view());}catch{setBlocked(true);}}finally{setBusy(false);}
  }
  if(blocked)return <main className="p-6"><h1>Local synthetic walkthrough</h1><p role="alert">{error ?? "LOCAL_ONLY"}</p></main>;
  if(!view)return <main className="p-6"><h1>Local synthetic walkthrough</h1><p role="status">Checking local browser boundary. No case has been activated.</p></main>;
  const canEdit=!busy&&view.submissions===0;
  const canAuthorize=canEdit&&view.stage==="ASSESSED"&&view.assessment?.decision==="PAY"&&view.fundingEligible;
  const canAssess=canEdit&&!(view.packet&&view.packet.intent.version===view.version);
  const next = view.stage==="SUBMITTED_MOCK"||view.stage==="UNKNOWN"
    ? {label:"Observe fake outcome",run:(j:Journey)=>j.reconcile(),disabled:false}
    : view.stage==="ASSURED_MOCK"
    ? {label:"Submit to fake adapter",run:(j:Journey)=>j.execute(),disabled:false}
    : canAuthorize
    ? {label:"Acknowledge mock intent",run:(j:Journey)=>j.authorize(view.caseId,view.version,view.assessment!.id),disabled:false}
    : {label:"Assess mock case",run:(j:Journey)=>j.assess(),disabled:!canAssess};
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8" style={{overflowWrap:"anywhere",paddingBottom:"18rem"}}>
    <header className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest">Tameion · local demonstration</p>
      <h1 className="text-2xl font-semibold sm:text-3xl">Local synthetic walkthrough</h1>
      <p data-testid="synthetic-notice" className="rounded border border-[var(--color-border-strong)] bg-white p-3 font-bold">{SYNTHETIC_NOTICE}</p>
      <p>Invented cases · browser memory only · fake adapter · no real authentication, signing or payment. Reload discards this session. The genuine queue remains withdrawn.</p>
      <a className="underline" href="/">View the withdrawn genuine queue</a>
    </header>
    <nav aria-label="Invented case selection" className="flex flex-wrap gap-3">
      {(["A","B"] as const).map(id=><button key={id} className={button} aria-pressed={view.caseId===`MOCK-CASE-${id}`} disabled={busy} onClick={()=>void act(j=>j.select(`MOCK-CASE-${id}`))}>Mock case {id}</button>)}
    </nav>
    {error&&<p role="alert" className="rounded border border-[var(--color-border-strong)] bg-white p-4 font-semibold">{error}</p>}
    <section className={card} aria-labelledby="next-heading" data-testid="next-action">
      <h2 id="next-heading" className="text-lg font-semibold">Next action · {view.caseId}</h2>
      <p className="my-3">{guidance(view)}</p>
      <div className="flex flex-wrap gap-3">
        <button className={button} disabled={!canAssess} onClick={()=>void act(j=>j.assess())}>Assess mock case</button>
        <button className={button} disabled={!canAuthorize} onClick={()=>void act(j=>j.authorize(view.caseId,view.version,view.assessment!.id))}>Acknowledge exact mock intent</button>
        <button className={button} disabled={busy||view.submissions>0||!view.packet} onClick={()=>void act(j=>j.execute())}>Submit to fake adapter</button>
        <button className={button} disabled={busy||!view.executionRef} onClick={()=>void act(j=>j.reconcile())}>Observe recorded fake outcome</button>
      </div>
      <p role="status" className="mt-3 text-sm">{busy?"Local operation in progress; no external request.":"Local state is current; no background processing."}</p>
    </section>
    <div className="grid gap-5 md:grid-cols-2">
      <section className={card} aria-labelledby="case-heading">
        <h2 id="case-heading" className="text-lg font-semibold">Invented obligation</h2>
        <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>Case</dt><dd>{view.caseId}</dd><dt>Version</dt><dd>{view.version}</dd>
          <dt>Amount</dt><dd>{view.amount} mock units</dd><dt>Destination</dt><dd>{view.destination}</dd>
          <dt>Mock funding</dt><dd>{view.fundingEligible?"Eligible (invented)":"INELIGIBLE — funding hold"}</dd>
          <dt>Stage</dt><dd data-testid="journey-stage" className="font-semibold">{view.stage}</dd>
        </dl>
        <label htmlFor="mock-scenario" className="block font-semibold">Mock scenario</label>
        <select id="mock-scenario" className="my-2 w-full rounded border border-[var(--color-border-strong)] bg-white p-3" value={view.scenario} disabled={!canEdit} onChange={e=>void act(j=>j.scenario(e.target.value as Scenario))}>
          {SCENARIOS.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}
        </select>
        <p className="mb-3 text-sm">Changing inputs increments the version. Previous evidence remains in the audit, but cannot authorize the new intent.</p>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={!canEdit} onClick={()=>void act(j=>j.changeAmount())}>Change mock amount</button><button className={button} disabled={!canEdit} onClick={()=>void act(j=>j.changeDestination())}>Change mock destination</button></div>
      </section>
      <section className={card} aria-labelledby="assessment-heading" data-testid="advisory">
        <h2 id="assessment-heading" className="text-lg font-semibold">Advisory assessment</h2>
        {view.assessment?<div className="mt-4 space-y-3"><p className="text-xl font-bold">{view.assessment.decision} · advisory only</p><p>{view.assessment.why}</p><p className="text-sm">Assessment: {view.assessment.id}<br/>Bound to {view.caseId} · version {view.assessment.version}</p></div>:<p className="mt-4">No current assessment. Nothing is processing until you choose Assess mock case.</p>}
        <p className="mt-4 text-sm">Deterministic mock rules, not AI reasoning. PAY never grants execution authority or proves real funds.</p>
      </section>
      <section className={card} aria-labelledby="packet-heading" data-testid="mock-packet">
        <h2 id="packet-heading" className="text-lg font-semibold">Mock authorization and assurance</h2>
        {view.packet?<div className="mt-4 space-y-2"><p>Actor: {view.packet.actor} · invented role, not authenticated.</p><p>Unsigned mock packet · not a PAE · no cryptographic assurance.</p><p>{view.packet.id}</p><p>Bound case: {view.packet.intent.caseId} · version {view.packet.intent.version}<br/>Amount: {view.packet.intent.amount} · destination: {view.packet.intent.destination}<br/>Assessment: {view.packet.assessmentId}</p><p>Currentness: {view.packet.intent.version===view.version?"Exact current mock intent":"HISTORICAL ONLY — inputs changed"}</p></div>:<p className="mt-4">No mock authorization or packet recorded.</p>}
        {view.historicalOnly&&<p className="mt-3 font-semibold">HISTORICAL AUTHORITY: restored evidence cannot establish current eligibility. Mock submission will block.</p>}
      </section>
      <section className={card} aria-labelledby="execution-heading">
        <h2 id="execution-heading" className="text-lg font-semibold">Fake execution and reconciliation</h2>
        <p className="mt-4">Fake submissions: {view.submissions}</p><p>Recorded fake reference: {view.executionRef??"None"}</p><p>Recorded reconciliation: {view.reconciliation??"Not observed"}</p>
        <p className="mt-3">UNKNOWN is unresolved. No retry is offered; observation reads only this session’s fake evidence. No provider, database, wallet or payment API is called.</p>
      </section>
    </div>
    <section className={card} aria-labelledby="audit-heading" data-testid="mock-audit"><h2 id="audit-heading" className="text-lg font-semibold">Session audit · {view.caseId}</h2><ol className="mt-4 space-y-3">{view.events.map((e,i)=><li key={i} className="border-s-2 border-[var(--color-border-strong)] ps-3"><strong>{e.action}</strong> · {e.caseId} · version {e.version}<p>{e.detail}</p>{e.intent&&<p className="text-sm">Recorded intent: {e.intent.amount} · {e.intent.destination}</p>}{e.assessment&&<p className="text-sm">Assessment: {e.assessment.id}</p>}{e.packet&&<p className="text-sm">Unsigned packet: {e.packet.id} · {e.packet.intent.caseId} · version {e.packet.intent.version}</p>}</li>)}</ol></section>
    <section role="region" aria-label="Current mock next action" className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-[var(--color-border-strong)] bg-white p-3 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><p className="text-xs font-bold">{SYNTHETIC_NOTICE}</p><p className="text-sm">{view.caseId} · {view.stage}{view.stage==="UNKNOWN"?" · NO RETRY":""}</p></div>
        <button className={button} disabled={busy||next.disabled} onClick={()=>void act(next.run)}>Next: {next.label}</button>
      </div>
    </section>
    <footer className="text-sm font-semibold">{SYNTHETIC_NOTICE} · this local walkthrough is not production assurance or UAT acceptance.</footer>
  </main>;
}
