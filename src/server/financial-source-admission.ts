import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {operatorSourceRecordSchema} from './operator-source-records';

const text=z.string().min(1).max(128),hash=z.string().regex(/^[a-f0-9]{64}$/);
const context={approval_id:text,organization_id:z.literal('ORG-DEMO-001'),deployment_id:text,namespace:text,valid_from:z.iso.datetime({precision:3}),expires_at:z.iso.datetime({precision:3})};
const sourceSchema=z.object({...context,purpose:z.literal('TESTNET_FINANCIAL_SOURCE'),intent_id:text,classification:z.literal('TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT'),principal:z.literal('1.000000'),estimated_fee_ceiling:z.literal('0.002000'),estimated_total_ceiling:z.literal('1.002000'),source:operatorSourceRecordSchema}).strict();
const requesterSchema=z.object({...context,purpose:z.literal('FINANCIAL_REQUESTER_ACTOR_BINDING'),operator_key:text,credential_version:z.number().int().positive(),actor_id:text,source_sha256:hash,intent_id:text}).strict();
export type FinancialSourceAdmission=z.infer<typeof sourceSchema>;
export type FinancialRequesterBinding=z.infer<typeof requesterSchema>;
/** Immutable owner-approved canonical bytes. Runtime facts can reject, never approve. */
function approvedBytes(fd:number,expected:string|undefined):unknown{
 try{if(!expected||!hash.safeParse(expected).success)throw new Error('FINANCIAL_AUTHORITY_UNAVAILABLE');const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw new Error();const bytes=Buffer.alloc(65537);let size=0;while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}if(size>65536||createHash('sha256').update(bytes.subarray(0,size)).digest('hex')!==expected)throw new Error();const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));const value:unknown=JSON.parse(raw);if(JSON.stringify(value)!==raw)throw new Error();return value;}finally{closeSync(fd);}
}
function current(value:{deployment_id:string;namespace:string;valid_from:string;expires_at:string},env:Record<string,string|undefined>,now:number){
 const start=Date.parse(value.valid_from),end=Date.parse(value.expires_at);
 if(!Number.isSafeInteger(now)||now<0)throw new Error();
 if(value.deployment_id!==env.VERCEL_DEPLOYMENT_ID||value.namespace!==env.TAMEION_STATE_NAMESPACE||start>now||end<=now||end<=start||end-start>60*60*1000)throw new Error();
}
export function loadFinancialSourceAdmission(env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialSourceAdmission{
 try{const p=sourceSchema.parse(approvedBytes(openSync(join(process.cwd(),".tameion","financial-source.json"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),env.TAMEION_FINANCIAL_SOURCE_SHA256));current(p,env,now);if(!/^TESTNET-CONTROLLED-[A-Za-z0-9_.:-]+$/.test(p.source.obligation_id)||p.source.amount!=='1.00'||p.source.currency!=='USD'||p.source.issue_date!=null||p.source.due_date!==null||p.source.effective_due_date!=null||p.source.effective_due_date_basis!=null||p.source.business_purpose_confirmed!==false||p.source.source_evidence.some(e=>!e.content_sha256))throw new Error();return structuredClone(p);}catch{throw new Error('FINANCIAL_AUTHORITY_UNAVAILABLE');}
}
export function loadFinancialRequesterBinding(env:Record<string,string|undefined>=process.env,now=Date.now()):FinancialRequesterBinding{
 try{const p=requesterSchema.parse(approvedBytes(openSync(join(process.cwd(),".tameion","financial-requester.json"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),env.TAMEION_FINANCIAL_REQUESTER_SHA256));current(p,env,now);if(p.source_sha256!==env.TAMEION_FINANCIAL_SOURCE_SHA256)throw new Error();return structuredClone(p);}catch{throw new Error('FINANCIAL_REQUESTER_UNAVAILABLE');}
}
