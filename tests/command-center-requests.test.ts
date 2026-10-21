import { describe, expect, it } from "vitest";

import {
  executionResponseNeedsReconciliation,
  assessmentEarlierReference,
  interpretPostResponse,
  isCurrentRequest,
  parseJsonBody,
} from "../src/client/command-center-requests";

describe("command-center request safety", () => {
  it("applies a detail response only when its selection and generation are still current", () => {
    expect(isCurrentRequest({ requestId: 3, currentRequestId: 3, requestedSelection: "A", currentSelection: "A" })).toBe(true);
  });

  it("drops a late response for a superseded selection (A→B reversed resolution)", () => {
    expect(isCurrentRequest({ requestId: 1, currentRequestId: 2, requestedSelection: "A", currentSelection: "B" })).toBe(false);
  });

  it("drops a response after deselection", () => {
    expect(isCurrentRequest({ requestId: 4, currentRequestId: 5, requestedSelection: "A", currentSelection: "" })).toBe(false);
  });
});

describe("command-center POST recovery", () => {
  it("never throws on an empty body (upstream 500 with no body)", () => {
    const result = interpretPostResponse(500, "");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.data).toBeNull();
    expect(result.message).toContain("HTTP 500");
  });

  it("treats an HTML 401 login page as a typed refusal, not parsed JSON", () => {
    const result = interpretPostResponse(401, "<!DOCTYPE html><html>Sign in</html>");
    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).not.toContain("<!DOCTYPE");
  });

  it("surfaces a server-supplied error string from a JSON refusal", () => {
    const result = interpretPostResponse(409, JSON.stringify({ error: "Aggregate changed." }));
    expect(result).toMatchObject({ ok: false, status: 409, message: "Aggregate changed." });
  });

  it("reports a successful JSON body as ok without altering it", () => {
    const result = interpretPostResponse(200, JSON.stringify({ status: "PASS" }));
    expect(result).toMatchObject({ ok: true, status: 200, data: { status: "PASS" } });
  });

  it("parseJsonBody returns null for malformed input instead of throwing", () => {
    expect(parseJsonBody("{not json")).toBeNull();
    expect(parseJsonBody("")).toBeNull();
  });
});

import { assessmentKeyDisposition, isSameIdentity } from "../src/client/command-center-requests";

describe("action results apply only to the still-selected obligation identity", () => {
  it("applies when the selection still equals the action's obligation", () => {
    expect(isSameIdentity("OBL-A", "OBL-A")).toBe(true);
  });

  it("drops a late result for A once the selection is B, even at equal aggregate version", () => {
    expect(isSameIdentity("OBL-B", "OBL-A")).toBe(false);
  });

  it("drops a late result after deselection", () => {
    expect(isSameIdentity("", "OBL-A")).toBe(false);
  });
});

describe("assessment recovery key is retained until identity-matched complete success", () => {
  const validSuccess = fullReceipt("OBL-A", "1");

  it("releases only on a valid, identity-matched 200 receipt", () => {
    expect(assessmentKeyDisposition({ status: 200, data: validSuccess, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RELEASE");
  });

  it("retains on an empty 200 body", () => {
    expect(assessmentKeyDisposition({ status: 200, data: null, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it("retains on an HTML 200 body (parsed as null)", () => {
    expect(assessmentKeyDisposition({ status: 200, data: null, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it("retains on a structurally invalid 200 JSON body", () => {
    expect(assessmentKeyDisposition({ status: 200, data: { ok: true }, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it("retains on a 200 receipt bound to a different obligation", () => {
    expect(assessmentKeyDisposition({ status: 200, data: validSuccess, obligationId: "OBL-B", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it("retains on a network failure (status 0)", () => {
    expect(assessmentKeyDisposition({ status: 0, data: { error: "network" }, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it("retains on a transient server error", () => {
    expect(assessmentKeyDisposition({ status: 500, data: { error: "boom" }, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });

  it.each([0, 200, 400, 409, 503])("retains ASM-001 without independently proven completion at HTTP %s", (status) => {
    expect(assessmentKeyDisposition({ status, data: { code: "ASM-001", error: "stale result" }, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });
});

import { assessmentReceiptIdentity, assessmentReceiptSnapshot, isCurrentGeneration } from "../src/client/command-center-requests";

const HASH = "a".repeat(64);
const fullReceipt = (obligationId: string, version: string) => ({
  assessment_id: "ASM-1", assessment_hash: HASH, aggregate_version: version,
  decision: { obligation_id: obligationId, decision: "HOLD", reasons: ["reason"] },
  provider_used: "NVIDIA", provider_mode: "LIVE_AI",
});

describe("selection generation binds A→B→A action completions", () => {
  it("drops a completion issued under an earlier generation even when the same obligation is selected again", () => {
    expect(isCurrentGeneration(1, 3)).toBe(false);
  });
  it("applies only under the generation that issued it", () => {
    expect(isCurrentGeneration(3, 3)).toBe(true);
  });
});

describe("recovery key release requires the complete receipt validator used for snapshot construction", () => {
  it("releases on a complete receipt bound to the selected obligation and requested version", () => {
    expect(assessmentKeyDisposition({ status: 200, data: fullReceipt("OBL-A", "1"), obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RELEASE");
  });
  it("retains on the weak shape with an empty assessment_id and obligation-only decision", () => {
    expect(assessmentKeyDisposition({ status: 200, data: { assessment_id: "", decision: { obligation_id: "OBL-A" } }, obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });
  it("retains when the receipt's aggregate version differs from the requested one", () => {
    expect(assessmentKeyDisposition({ status: 200, data: fullReceipt("OBL-A", "2"), obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });
  it("retains on an equal-version receipt bound to a different obligation", () => {
    expect(assessmentKeyDisposition({ status: 200, data: fullReceipt("OBL-B", "1"), obligationId: "OBL-A", expectedAggregateVersion: "1" })).toBe("RETAIN");
  });
  it("exposes a snapshot only for a receipt the validator accepts", () => {
    expect(assessmentReceiptSnapshot(fullReceipt("OBL-A", "1"))).not.toBeNull();
    expect(assessmentReceiptSnapshot({ assessment_id: "", decision: { obligation_id: "OBL-A" } })).toBeNull();
  });
  it("reports the receipt's identity for mismatch checks", () => {
    expect(assessmentReceiptIdentity(fullReceipt("OBL-B", "1"))).toEqual({ obligation_id: "OBL-B", aggregate_version: "1" });
  });
});

describe("execute production response contract", () => {
  it('S05-F01 recognises the exact pre-effect wallet refusal only',()=>{
    expect(executionResponseNeedsReconciliation({status:503,data:{code:'BALANCE_NOT_VERIFIED'}})).toBe(false);
  });
  it.each([0,200,202,400,401,403,409,500,502,504])('S05-F01 keeps wallet code uncertain at status %s',status=>{
    expect(executionResponseNeedsReconciliation({status,data:{code:'BALANCE_NOT_VERIFIED'}})).toBe(true);
  });
  it.each([
    null,[],['BALANCE_NOT_VERIFIED'],'BALANCE_NOT_VERIFIED',{},
    Object.assign(Object.create({code:'BALANCE_NOT_VERIFIED'}),{other:true}),
    {code:'PROVIDER_BALANCE_NOT_VERIFIED'},{code:'OUTCOME_UNVERIFIED'},
    {code:'BALANCE_NOT_VERIFIED',outcome:'UNKNOWN'},
    {code:'BALANCE_NOT_VERIFIED',retry_submission:false},
    {code:'BALANCE_NOT_VERIFIED',retry_submission:true},
    {code:'BALANCE_NOT_VERIFIED',execution:{status:'UNKNOWN'}},
    {code:'BALANCE_NOT_VERIFIED',execution_gate:'RECONCILIATION_ONLY'},
    {code:'BALANCE_NOT_VERIFIED',error:'Retry'},
    {code:'NO_RECORDED_EXECUTION'},
  ])('S05-F01 preserves uncertainty for non-exact wallet response %j',data=>{
    expect(executionResponseNeedsReconciliation({status:503,data})).toBe(true);
  });
  it.each([
    [400,"BODY_REJECTED"], [408,"BODY_REJECTED"], [413,"BODY_REJECTED"],
    [415,"CONTENT_TYPE_REJECTED"], [405,"METHOD_NOT_ALLOWED"],
    [403,"CSRF_REJECTED"], [403,"CONTROLLED_SOURCE_REQUIRED"],
    [403,"EXACT_PACKET_NOT_APPROVED"], [409,"CURRENT_PAE_REQUIRED"],
  ] as const)("recognises only pre-effect refusal %s %s", (status,code) => {
    expect(executionResponseNeedsReconciliation({status,data:{code}})).toBe(false);
    expect(executionResponseNeedsReconciliation({status:200,data:{code}})).toBe(true);
    expect(executionResponseNeedsReconciliation({status:503,data:{code}})).toBe(true);
    expect(executionResponseNeedsReconciliation({status,data:{code,execution:{status:"UNKNOWN"}}})).toBe(true);
  });
  it.each([
    [0,null], [502,null], [504,null], [200,null], [200,{status:"PASS"}],
    [200,{code:"RECONCILED",execution:{status:"SETTLED"}}],
    [401,{code:"SESSION_REQUIRED"}], [403,{code:"REQUESTER_UNVERIFIED"}],
    [409,{code:"UNRECOGNISED",blocker:"INSUFFICIENT_BALANCE"}],
    [403,{code:"CSRF_REJECTED",retry_submission:false}],
    [403,{code:"CSRF_REJECTED",outcome:"UNKNOWN"}],
    [400,{code:"BODY_REJECTED",error:"Retry"}],
    [409,{code:"CURRENT_PAE_REQUIRED",execution_gate:"RECONCILIATION_ONLY"}],
  ])("keeps ambiguous response %s %j reconciliation-only", (status,data) => {
    expect(executionResponseNeedsReconciliation({status:status as number,data})).toBe(true);
  });
});


describe('R1 strict earlier-reference hints',()=>{
 const attempted='00000000-0000-4000-8000-000000000301',earlier='00000000-0000-4000-8000-000000000302';
 const reply={code:'ASM-OPERATION-UNRESOLVED',error:'Earlier request unresolved.',idempotency_key:earlier};
 it.each([undefined,'RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN'])('accepts existing shape with state %s only as a reference hint',operation_status=>{
  expect(assessmentEarlierReference({status:409,data:{...reply,...(operation_status===undefined?{}:{operation_status})}},attempted)).toBe(earlier);
 });
 it.each([['UNKNOWN'],{toString:'poison'},null,1,'COMPLETED'])('rejects malformed state %j without coercion or throwing',operation_status=>{
  expect(assessmentEarlierReference({status:409,data:{...reply,operation_status}},attempted)).toBeNull();
 });
 it.each([0,200,202,403,503])('does not treat HTTP%s as an authenticated conflict',status=>expect(assessmentEarlierReference({status,data:reply},attempted)).toBeNull());
});


describe('R1 contradictory complete receipts',()=>{
 it('retains an otherwise complete receipt carrying ASM-001',()=>{
  const data={...fullReceipt('OBL-A','1'),code:'ASM-001'};
  expect(assessmentKeyDisposition({status:200,data,obligationId:'OBL-A',expectedAggregateVersion:'1'})).toBe('RETAIN');
  expect(assessmentReceiptSnapshot(data)).toBeNull();
 });
});


describe('bounded assessment admission rejection and safe read failures',()=>{
 it('recognizes only the exact pre-reservation history-limit response, never uncertainty or generic denial',async()=>{
  const {isAssessmentHistoryLimitRejection}=await import('../src/client/command-center-requests');
  expect(isAssessmentHistoryLimitRejection({status:409,data:{code:'GENUINE_ASSESSMENT_HISTORY_LIMIT'}})).toBe(true);
  for(const status of [0,200,202,400,403,500,503])expect(isAssessmentHistoryLimitRejection({status,data:{code:'GENUINE_ASSESSMENT_HISTORY_LIMIT'}})).toBe(false);
  for(const data of [null,[],{code:'ASM_STATUS_NOT_FOUND'},{code:'ASM-UNKNOWN'},{code:'ASM-001'},{code:'GENUINE_ASSESSMENT_HISTORY_LIMIT',status:'UNKNOWN'},{code:'GENUINE_ASSESSMENT_HISTORY_LIMIT',attempt_consumed:true}])expect(isAssessmentHistoryLimitRejection({status:409,data})).toBe(false);
 });
 it('shows only a known typed read code, never unknown codes or raw error values',async()=>{
  const {observedReadFailure}=await import('../src/client/command-center-requests');
  expect(observedReadFailure(409,{code:'SOURCE_BINDING_CHANGED',error:'PRIVATE'})).toBe('Obligations unavailable (HTTP 409; SOURCE_BINDING_CHANGED).');
  for(const body of [null,'PRIVATE',{error:'PRIVATE'},{code:'PRIVATE'},{code:'SOURCE_BINDING_CHANGED PRIVATE'},{code:['SOURCE_BINDING_CHANGED']}])expect(observedReadFailure(503,body)).toBe('Obligations unavailable (HTTP 503).');
 });
});


describe('exact source-basis rejection is presentation only',()=>{
 it('requires genuine advisory context, exact 409 and an own singleton code',async()=>{
  const {isAssessmentBasisRejection}=await import('../src/client/command-center-requests');
  const data={code:'GENUINE_ASSESSMENT_BASIS_INVALID'};
  expect(isAssessmentBasisRejection({status:409,data},true)).toBe(true);
  expect(isAssessmentBasisRejection({status:409,data},false)).toBe(false);
  for(const status of [0,200,202,400,403,404,500,503])expect(isAssessmentBasisRejection({status,data},true)).toBe(false);
  for(const body of [null,[],data.code,{code:[data.code]},{code:'UNKNOWN'},Object.assign(Object.create(data),{other:true}),{...data,status:'UNKNOWN'},{...data,attempt_consumed:false},{...data,error:'PRIVATE'},{...data,receipt:{}}])expect(isAssessmentBasisRejection({status:409,data:body},true)).toBe(false);
 });
 it('never releases a request key for the canonical rejection or a not-found status',()=>{
  for(const data of [{code:'GENUINE_ASSESSMENT_BASIS_INVALID'},{status:'NOT_FOUND'}])
   expect(assessmentKeyDisposition({status:409,data,obligationId:'SYNTHETIC-OBLIGATION',expectedAggregateVersion:'1'})).toBe('RETAIN');
 });
});
