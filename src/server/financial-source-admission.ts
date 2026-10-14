import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {deploymentApprovalSchema} from './deployment-approval';
import {operatorSourceRecordSchema} from './operator-source-records';

const text=z.string().min(1).max(128),hash=z.string().regex(/^[a-f0-9]{64}$/),origin=z.string().url().max(512);
const temporal={approval_id:text,organization_id:z.literal('ORG-DEMO-001'),namespace:text,valid_from:z.iso.datetime({precision:3}),expires_at:z.iso.datetime({precision:3})};
const legacyContext=z.object({...temporal,deployment_id:text}).strict();
const gitShaPreviewContext=z.object({...temporal,binding:z.literal('git-sha-preview-v1'),git_commit_sha:z.string().regex(/^[a-f0-9]{40}$/),project_id:text,environment:z.literal('preview'),origin,ingress_approval_id:text,ingress_record_sha256:hash,source_record_sha256:hash}).strict();
const sourceFields={linked_instruction:z.object({source_obligation_id:text,instruction_content_sha256:hash}).strict().optional(),purpose:z.literal('TESTNET_FINANCIAL_SOURCE'),intent_id:text,classification:z.literal('TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT'),principal:z.literal('1.000000'),estimated_fee_ceiling:z.literal('0.002000'),estimated_total_ceiling:z.literal('1.002000'),source:operatorSourceRecordSchema};
const requesterFields={purpose:z.literal('FINANCIAL_REQUESTER_ACTOR_BINDING'),operator_key:text,credential_version:z.number().int().positive(),actor_id:text,source_sha256:hash,intent_id:text};
const sourceSchema=z.union([legacyContext.extend(sourceFields),gitShaPreviewContext.extend(sourceFields)]);
const requesterSchema=z.union([legacyContext.extend(requesterFields),gitShaPreviewContext.extend(requesterFields)]);
export type FinancialSourceAdmission=z.infer<typeof sourceSchema>;
export type FinancialRequesterBinding=z.infer<typeof requesterSchema>;

/** Exact owner-approved canonical bytes. Runtime facts can reject, never approve. */
function approvedBytes(fd:number,expected:string|undefined):Uint8Array{
 try{if(!expected||!hash.safeParse(expected).success)throw new Error();const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw new Error();const bytes=Buffer.alloc(65537);let size=0;while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}const approved=bytes.subarray(0,size);if(size>65536||createHash('sha256').update(approved).digest('hex')!==expected)throw new Error();return approved;}finally{closeSync(fd);}
}
function parseCanonical(bytes:Uint8Array):unknown{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const value:unknown=JSON.parse(raw);if(JSON.stringify(value)!==raw)throw new Error();return value;}
function allowedOrigins(env:Record<string,string|undefined>):string[]{const value:unknown=JSON.parse(env.TAMEION_ALLOWED_ORIGINS??'null');if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw new Error();return value as string[];}
function contextStatus(value:z.infer<typeof legacyContext>|z.infer<typeof gitShaPreviewContext>,env:Record<string,string|undefined>,now:number):'ACTIVE'|'INACTIVE'{
 const start=Date.parse(value.valid_from),end=Date.parse(value.expires_at);if(!Number.isSafeInteger(now)||now<0||end<=start||end-start>60*60*1000)throw new Error();
 if('binding' in value){
  const raw=env.TAMEION_INGRESS_RECORD;if(!raw||JSON.stringify(JSON.parse(raw))!==raw||createHash('sha256').update(raw).digest('hex')!==value.ingress_record_sha256)throw new Error();
  const ingress=deploymentApprovalSchema.parse(JSON.parse(raw));
  if(!('binding' in ingress)||ingress.binding!==value.binding||ingress.approval_id!==value.ingress_approval_id||ingress.git_commit_sha!==value.git_commit_sha||ingress.project_id!==value.project_id||ingress.environment!==value.environment||ingress.origins.length!==1||ingress.origins[0]!==value.origin)throw new Error();
  const origins=allowedOrigins(env);if(origins.length!==1||origins[0]!==value.origin||env.VERCEL!=='1'||env.VERCEL_GIT_COMMIT_SHA!==value.git_commit_sha||env.VERCEL_PROJECT_ID!==value.project_id||env.VERCEL_ENV!==value.environment)throw new Error();
 }else if(value.deployment_id!==env.VERCEL_DEPLOYMENT_ID||value.namespace!==env.TAMEION_STATE_NAMESPACE)throw new Error();
 return start<=now&&now<end?'ACTIVE':'INACTIVE';
}
function openApproved(name:string,expected:string|undefined):Uint8Array{return approvedBytes(openSync(join(process.cwd(),'.tameion',name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),expected);}
function parseFinancialSourceWithStatus(bytes:Uint8Array,expected:string,env:Record<string,string|undefined>,now:number){
 const packet=sourceSchema.parse(parseCanonical(bytes)),status=contextStatus(packet,env,now);
 if(!/^TESTNET-CONTROLLED-[A-Za-z0-9_.:-]+$/.test(packet.source.obligation_id)||packet.source.amount!=='1.00'||packet.source.currency!=='USD'||packet.source.issue_date!=null||packet.source.due_date!==null||packet.source.effective_due_date!=null||packet.source.effective_due_date_basis!=null||packet.source.business_purpose_confirmed!==false||packet.source.source_evidence.some(e=>!e.content_sha256))throw new Error();
 if(packet.source.obligation_id.startsWith('TESTNET-CONTROLLED-LINKED-')&&!packet.linked_instruction)throw new Error();
 if('binding' in packet&&createHash('sha256').update(JSON.stringify(packet.source)).digest('hex')!==packet.source_record_sha256)throw new Error();
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error();return {packet:structuredClone(packet),status};
}
function parseFinancialRequesterWithStatus(bytes:Uint8Array,expected:string,env:Record<string,string|undefined>,now:number){const packet=requesterSchema.parse(parseCanonical(bytes)),status=contextStatus(packet,env,now);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error();return {packet:structuredClone(packet),status};}
export function parseFinancialSource(bytes:Uint8Array,expected:string,env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialSourceAdmission{const parsed=parseFinancialSourceWithStatus(bytes,expected,env,now);if(parsed.status!=='ACTIVE')throw new Error();return parsed.packet;}
export function parseFinancialRequester(bytes:Uint8Array,expected:string,env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialRequesterBinding{const parsed=parseFinancialRequesterWithStatus(bytes,expected,env,now);if(parsed.status!=='ACTIVE')throw new Error();return parsed.packet;}
function readFinancialSource(env:Record<string,string|undefined>,now:number){const expected=env.TAMEION_FINANCIAL_SOURCE_SHA256??'';return parseFinancialSourceWithStatus(openApproved('financial-source.json',expected),expected,env,now);}
function readFinancialRequester(env:Record<string,string|undefined>,now:number){const expected=env.TAMEION_FINANCIAL_REQUESTER_SHA256??'',parsed=parseFinancialRequesterWithStatus(openApproved('financial-requester.json',expected),expected,env,now);if(parsed.packet.source_sha256!==env.TAMEION_FINANCIAL_SOURCE_SHA256)throw new Error();return parsed;}
export function loadFinancialSourceAdmission(env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialSourceAdmission{try{const parsed=readFinancialSource(env,now);if(parsed.status!=='ACTIVE')throw new Error();return parsed.packet;}catch{throw new Error('FINANCIAL_AUTHORITY_UNAVAILABLE');}}
export function loadOptionalFinancialSourceAdmission(env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialSourceAdmission|undefined{
 const exists=(name:string)=>{try{const fd=openSync(join(process.cwd(),'.tameion',name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);closeSync(fd);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
 try{const sourceFile=exists('financial-source.json'),requesterFile=exists('financial-requester.json'),sourceConfigured=env.TAMEION_FINANCIAL_SOURCE_SHA256!==undefined,requesterConfigured=env.TAMEION_FINANCIAL_REQUESTER_SHA256!==undefined;if(!sourceFile&&!requesterFile&&!sourceConfigured&&!requesterConfigured)return undefined;if(!sourceFile||!requesterFile||!sourceConfigured||!requesterConfigured)throw new Error();const source=readFinancialSource(env,now),requester=readFinancialRequester(env,now);if(source.packet.organization_id!==requester.packet.organization_id||source.packet.namespace!==requester.packet.namespace||source.packet.intent_id!==requester.packet.intent_id||source.packet.valid_from!==requester.packet.valid_from||source.packet.expires_at!==requester.packet.expires_at||source.status!==requester.status||!sameFinancialBinding(source.packet,requester.packet))throw new Error();return source.status==='ACTIVE'?source.packet:undefined;}catch{throw new Error('FINANCIAL_AUTHORITY_UNAVAILABLE');}
}
export function loadFinancialRequesterBinding(env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialRequesterBinding{try{const parsed=readFinancialRequester(env,now);if(parsed.status!=='ACTIVE')throw new Error();return parsed.packet;}catch{throw new Error('FINANCIAL_REQUESTER_UNAVAILABLE');}}
export function sameFinancialBinding(source:FinancialSourceAdmission,requester:FinancialRequesterBinding):boolean{
 const keys='binding' in source?['binding','git_commit_sha','project_id','environment','origin','ingress_approval_id','ingress_record_sha256','source_record_sha256'] as const:['deployment_id'] as const;
 return ('binding' in source)===('binding' in requester)&&keys.every(key=>(source as unknown as Record<string,unknown>)[key]===(requester as unknown as Record<string,unknown>)[key]);
}
