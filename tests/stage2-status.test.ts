import {afterEach,expect,it,vi} from 'vitest';
import {providerCategories,stage2Status,providerCategory} from '../src/domain/assessment-status';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
for(const category of providerCategories)it(`safe provider catalogue ${category} supplies owner/remedy without unsupported HTTP cause`,()=>{
 const s=stage2Status(category);expect(s.owner.length).toBeGreaterThan(0);expect(s.remedy.length).toBeGreaterThan(0);expect(s.resume.length).toBeGreaterThan(0);expect(JSON.stringify(s)).not.toMatch(/HTTP 401|HTTP 403|wrong secret|cost limit|was not sent|provider received/i);expect(providerCategory(category)).toBe(category);
});
it('missing/unknown/status-only messages never infer provider dispatch or echo private input',()=>{
 expect(providerCategory('HTTP 401')).toBeUndefined();expect(providerCategory(null)).toBeUndefined();for(const value of [undefined,null,'SYNTHETIC_PRIVATE_CANARY'])expect(JSON.stringify(stage2Status(value))).not.toContain('SYNTHETIC_PRIVATE_CANARY');
 expect(stage2Status('RESERVED').reason).toContain('does not prove provider receipt');expect(stage2Status('SUBMITTING').reason).toContain('not yet confirmed');expect(stage2Status('SOURCE_CHANGED').remedy).not.toBe(stage2Status('FINANCIAL_HISTORY').remedy);
});
async function assessed(status:number,body:unknown){const h=sourceHarness(),id=(await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic category binding'}))).json()).obligation.obligation_id;vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-OFFLINE');const calls=vi.fn(async()=>Response.json(body,{status}));vi.stubGlobal('fetch',calls);const r=await h.handler('assess',h.request({}),id);return{h,id,r,calls};}
for(const http of [400,401,403,404,422])it(`committed configuration category HTTP${http} bound to receipt/source; app response is not upstream status`,async()=>{
 const{h,id,r,calls}=await assessed(http,{error:{message:'SYNTHETIC_PRIVATE_CANARY'}});expect(r.status).toBe(200);const body=await r.json();expect(body.stage2_provider_outcome).toBe('CONFIGURATION_REJECTED');expect(calls).toHaveBeenCalledTimes(1);expect(JSON.stringify(body)).not.toContain('SYNTHETIC_PRIVATE_CANARY');
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(detail.stage2_provider_outcome).toBe('CONFIGURATION_REJECTED');
 await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,description:'Changed source'},reason:'Correction'}),id);
 const changed=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(changed.stage2_provider_outcome).toBeUndefined();
});
for(const[status,body,expected]of [[429,{},'RATE_LIMITED'],[200,{choices:[{message:{refusal:'SYNTHETIC_PRIVATE_CANARY'}}]},'REFUSED'],[200,{choices:[{message:{content:'invalid'}}]},'INVALID_OUTPUT']]as const)it(`committed ${expected} keeps typed evidence without raw provider data`,async()=>{
 const{r}=await assessed(status,body);expect(r.status).toBe(200);const b=await r.json();expect(b.stage2_provider_outcome).toBe(expected);expect(JSON.stringify(b)).not.toContain('SYNTHETIC_PRIVATE_CANARY');
});
it('transport uncertainty is UNKNOWN, not fabricated committed provider category',async()=>{
 const{r,h,id}=await assessed(503,{});expect(r.status).toBe(409);const b=await r.json();expect(b.code).toBe('ASM-UNKNOWN');expect(b.stage2_provider_outcome).toBeUndefined();const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(detail.stage2_provider_outcome).toBeUndefined();
});
it('display-only Stage2 labels are plain language without changing financial/internal values',async()=>{
 const{stage2DisplayLabel}=await import('../src/client/command-center-state');
 for(const internal of ['Assessment outcome unverified','Latest assessment UNKNOWN','Outcome unverified'])expect(stage2DisplayLabel(internal)).toBe('Assessment completion not confirmed');
 expect(stage2DisplayLabel('Assessment pending')).toBe('Assessment confirmation pending');expect(stage2DisplayLabel('Assessment in progress')).toBe('Assessment request saved; result pending');
 expect(stage2DisplayLabel('UNKNOWN')).toBe('UNKNOWN');expect(stage2DisplayLabel('Payment outcome unverified')).toBe('Payment outcome unverified');
});
