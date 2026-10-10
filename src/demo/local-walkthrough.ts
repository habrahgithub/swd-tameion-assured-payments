import { FakeProviderAdapter } from "../execution/fake-provider-adapter";

/** A presentation-only local model. No imports of source, signing, authority,
 * worker, AI, wallet or persistence modules. Mock packets confer no authority. */
export const SYNTHETIC_NOTICE = "SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT";
export const SCENARIOS = ["PAY", "HOLD", "ESCALATE", "FUNDING_HOLD", "HISTORICAL_AUTHORITY", "PACKET_MISMATCH", "UNKNOWN", "DESTINATION_CHANGED"] as const;
export type Scenario = typeof SCENARIOS[number];
type CaseId = "MOCK-CASE-A" | "MOCK-CASE-B";
type Stage = "OBLIGATION" | "ASSESSED" | "ASSURED_MOCK" | "SUBMITTED_MOCK" | "RECONCILED_MOCK" | "UNKNOWN" | "BLOCKED";
interface Intent { caseId: CaseId; version: number; amount: string; destination: string }
interface Assessment { id: string; version: number; decision: "PAY" | "HOLD" | "ESCALATE"; why: string }
interface Packet { id: string; assessmentId: string; actor: "MOCK_REVIEWER"; signed: false; intent: Intent }
export interface WalkthroughView extends Intent {
  stage: Stage; scenario: Scenario; assessment: Assessment | null; packet: Packet | null;
  fundingEligible: boolean; historicalOnly: boolean; submissions: number;
  executionRef: string | null; reconciliation: string | null;
  events: Array<{action:string;caseId:CaseId;version:number;detail:string;packet?:Packet;assessment?:Assessment;intent?:Intent}>;
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::(?:[1-9]\d{0,4}))?$/;
export function localRequestAllowed(headers: Headers, hosted: boolean): boolean {
  const host = headers.get("host") ?? "";
  if (hosted || !LOCAL_HOST.test(host)) return false;
  try { const parsed=new URL(`http://${host}`);if(parsed.port&&Number(parsed.port)>65535)return false; } catch { return false; }
  for (const name of headers.keys()) {
    if (name === "forwarded" || name.startsWith("x-forwarded-") || name.startsWith("x-vercel-") || name === "cf-connecting-ip") return false;
  }
  const origin = headers.get("origin");
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return false;
  const fetchSite = headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "none" || fetchSite === "same-origin";
}
/** Next adds these headers to direct requests. Accept only its loopback shape;
 * this is defense in depth, not trusted remote identity. The browser independently
 * rejects non-loopback activation and the model has only the fake adapter. */
export function localNextRequestAllowed(headers: Headers, hosted: boolean): boolean {
  const clean = new Headers(headers);
  const host=clean.get("host")??"";
  if(!LOCAL_HOST.test(host))return false;
  let url:URL;try{url=new URL(`http://${host}`);}catch{return false;}
  const proto=clean.get("x-forwarded-proto")??"http";
  const expected:Record<string,string[]>={
    "x-forwarded-host":[host],"x-forwarded-port":[url.port||(proto==="https"?"443":"80")],
    "x-forwarded-proto":["http","https"],"x-forwarded-for":["127.0.0.1","::1","::ffff:127.0.0.1"],
  };
  for(const [key,values] of Object.entries(expected)) {
    const value=clean.get(key);if(value!==null&&!values.includes(value))return false;
    clean.delete(key);
  }
  return localRequestAllowed(clean,hosted);
}
function assertLocalBrowser(): void {
  if (typeof window === "undefined") throw new Error("LOCAL_ONLY: top-level loopback browser required");
  const url = new URL(window.location.href);
  if (!['http:', 'https:'].includes(url.protocol) || !LOCAL_HOST.test(url.host) ||
      !window.isSecureContext || window.top !== window.self || window.opener !== null) {
    throw new Error("LOCAL_ONLY: top-level secure loopback browser required");
  }
}
function intent(view: WalkthroughView): Intent { return {caseId:view.caseId,version:view.version,amount:view.amount,destination:view.destination}; }
function sameIntent(a:Intent,b:Intent):boolean { return a.caseId===b.caseId && a.version===b.version && a.amount===b.amount && a.destination===b.destination; }

class LocalWalkthrough {
  #selected: CaseId = "MOCK-CASE-A";
  #cases = new Map<CaseId, WalkthroughView>();
  #adapters = new Map<CaseId, FakeProviderAdapter>();
  #busy = new Set<CaseId>();
  constructor() {
    assertLocalBrowser();
    for (const caseId of ["MOCK-CASE-A", "MOCK-CASE-B"] as const) {
      this.#cases.set(caseId, {caseId,version:1,amount:caseId==="MOCK-CASE-A"?"125.00":"72.50",destination:`MOCK-DEST-${caseId.slice(-1)}-1`,stage:"OBLIGATION",scenario:"PAY",assessment:null,packet:null,fundingEligible:true,historicalOnly:false,submissions:0,executionRef:null,reconciliation:null,events:[{action:"CREATED",caseId,version:1,detail:"Independently invented local case; no source record."}]});
      this.#adapters.set(caseId,new FakeProviderAdapter());
    }
  }
  #current():WalkthroughView { assertLocalBrowser();return this.#cases.get(this.#selected)!; }
  #event(v:WalkthroughView,action:string,detail:string):void { v.events.push(structuredClone({action,caseId:v.caseId,version:v.version,detail,packet:v.packet??undefined,assessment:v.assessment??undefined,intent:intent(v)})); }
  #editable(v:WalkthroughView):void { if(this.#busy.has(v.caseId)||v.submissions>0) throw new Error("NO_RETRY: submitted mock intent cannot be changed or replayed"); }
  view():WalkthroughView { return structuredClone(this.#current()); }
  select(caseId: string):WalkthroughView { assertLocalBrowser();if(caseId!=="MOCK-CASE-A"&&caseId!=="MOCK-CASE-B")throw new Error("IDENTITY: unknown mock case");if(this.#busy.size)throw new Error("NO_RETRY: wait for the local submission before changing case");this.#selected=caseId;return this.view(); }
  scenario(value:Scenario):WalkthroughView {
    const v=this.#current();this.#editable(v);if(!SCENARIOS.includes(value))throw new Error("BLOCKED: unknown scenario");
    v.scenario=value;v.fundingEligible=value!=="FUNDING_HOLD";v.historicalOnly=value==="HISTORICAL_AUTHORITY";
    v.version++;v.assessment=null;v.stage="OBLIGATION";
    this.#event(v,"INPUT_CHANGED",`Scenario ${value}; previous assessment and packet are historical only.`);return this.view();
  }
  changeAmount():WalkthroughView { const v=this.#current();this.#editable(v);v.amount=v.amount==="125.00"?"140.00":"125.00";this.#changed(v,"Mock amount changed.");return this.view(); }
  changeDestination():WalkthroughView { const v=this.#current();this.#editable(v);v.destination=`MOCK-DEST-${v.caseId.slice(-1)}-${v.version+1}`;this.#changed(v,"Mock destination changed; previous packet cannot execute.");return this.view(); }
  #changed(v:WalkthroughView,detail:string):void { v.version++;v.assessment=null;v.stage="OBLIGATION";this.#event(v,"INPUT_CHANGED",detail); }
  assess():WalkthroughView {
    const v=this.#current();this.#editable(v);
    if(v.packet&&sameIntent(v.packet.intent,intent(v)))throw new Error("BLOCKED: already authorized; no reassessment of sealed mock intent");
    const decision=v.scenario==="HOLD"?"HOLD":v.scenario==="ESCALATE"?"ESCALATE":"PAY";
    v.assessment={id:`MOCK-ASM-${crypto.randomUUID()}`,version:v.version,decision,why:decision==="HOLD"?"Invented evidence is incomplete. Resolve the mock evidence hold before authorization.":decision==="ESCALATE"?"Invented policy exception needs an independent reviewer. No authorization is available.":"Invented amount and destination are complete. PAY is advisory; mock funding and exact intent still require checks."};
    v.stage="ASSESSED";this.#event(v,"ASSESSED",`${decision}: deterministic local rules; no AI call.`);return this.view();
  }
  authorize(caseId:string,version:number,assessmentId:string):WalkthroughView {
    const v=this.#current();this.#editable(v);
    if(version!==v.version)throw new Error("STALE: reviewed version changed");
    if(caseId!==v.caseId||!v.assessment||assessmentId!==v.assessment.id)throw new Error("IDENTITY: reviewed case or assessment does not match");
    if(v.assessment.decision!=="PAY"||!v.fundingEligible||v.stage!=="ASSESSED")throw new Error("BLOCKED: PAY and mock funding eligibility required");
    v.packet={id:`MOCK-PACKET-${crypto.randomUUID()}`,assessmentId,actor:"MOCK_REVIEWER",signed:false,intent:intent(v)};
    v.stage="ASSURED_MOCK";this.#event(v,"AUTHORIZED_MOCK","Mock reviewer acknowledged the exact intent; unsigned packet, no real identity or assurance.");return this.view();
  }
  #sendGuard(v:WalkthroughView,packet:Packet):void {
    assertLocalBrowser();
    if(this.#selected!==v.caseId||v.stage!=="ASSURED_MOCK"||v.packet!==packet||!sameIntent(packet.intent,intent(v))||!v.assessment||packet.assessmentId!==v.assessment.id||v.assessment.decision!=="PAY"||!v.fundingEligible||v.historicalOnly||v.scenario==="PACKET_MISMATCH")throw new Error("BLOCKED: current case, eligibility or exact mock packet mismatch");
  }
  async execute():Promise<WalkthroughView> {
    const v=this.#current();if(v.submissions>0||this.#busy.has(v.caseId))throw new Error("NO_RETRY: mock intent already submitted or unresolved");
    const packet=v.packet;if(!packet)throw new Error("BLOCKED: no current mock authorization");
    try { this.#sendGuard(v,packet); } catch(error) {v.stage="BLOCKED";this.#event(v,"BLOCKED",String(error));throw error;}
    this.#busy.add(v.caseId);
    const adapter=this.#adapters.get(v.caseId)!;adapter.queueOutcome(v.scenario==="UNKNOWN"?"TIMEOUT":"CONFIRMED");
    try {
      const result=await adapter.submitTransfer({idempotencyKey:packet.id,sourceWalletRef:"MOCK-IN-MEMORY-ONLY",asset:"USDC",network:"ARC_TESTNET",destinationAddress:packet.intent.destination,atomicAmount:String(Math.round(Number(v.amount)*1e6)),beforeProviderSend:async()=>this.#sendGuard(v,packet)});
      v.submissions=adapter.getSubmissionCount();v.executionRef=result.providerRef;
      v.stage=result.status==="UNKNOWN"?"UNKNOWN":"SUBMITTED_MOCK";
      this.#event(v,v.stage,v.stage==="UNKNOWN"?"OUTCOME_UNVERIFIED / NO RETRY. One fake submission; outcome remains unknown.":"One fake submission recorded. Reconciliation is a separate observation.");
    } finally {this.#busy.delete(v.caseId);}
    return this.view();
  }
  async reconcile():Promise<WalkthroughView> {
    const v=this.#current();if(!v.executionRef||this.#busy.has(v.caseId))throw new Error("BLOCKED: no recorded mock execution");
    const recorded=await this.#adapters.get(v.caseId)!.getStatus(v.executionRef);
    assertLocalBrowser();
    v.reconciliation=recorded.status;
    if(recorded.status==="CONFIRMED")v.stage="RECONCILED_MOCK";
    this.#event(v,recorded.status==="CONFIRMED"?"RECONCILED_MOCK":"OBSERVED_MOCK",recorded.status==="CONFIRMED"?"Recorded fake confirmation observed; no external query or payment.":"Recorded fake outcome UNKNOWN; no retry or new submission.");
    return this.view();
  }
}
export function openLocalWalkthrough():LocalWalkthrough { return new LocalWalkthrough(); }
