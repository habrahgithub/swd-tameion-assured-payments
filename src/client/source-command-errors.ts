import {stage2Status} from '../domain/assessment-status';
/** Presentation only: never clears a request, retries a command or grants authority. */
export function isSourceCommand(path:string,method:string,target:string):boolean {
 return method==='POST'&&path==='/api/obligations'||method==='PATCH'&&target.length>0&&path===`/api/obligations/${encodeURIComponent(target)}`;
}
// Reuse existing static guidance, never the response's owner/title/remedy.
function typedSourceGuidance(code:string,status:403|409|503){const {title,owner,remedy}=stage2Status(code);return{status,title,owner,remedy};}
const guidance={
 SOURCE_BINDING_CHANGED:typedSourceGuidance('SOURCE_BINDING_CHANGED',409),
 EXISTING_FINANCIAL_CLAIM:typedSourceGuidance('EXISTING_FINANCIAL_CLAIM',409),
 SOURCE_PERMISSION_REQUIRED:typedSourceGuidance('SOURCE_PERMISSION_REQUIRED',403),
 SOURCE_INGRESS_EXPIRED_OR_CHANGED:typedSourceGuidance('SOURCE_INGRESS_EXPIRED_OR_CHANGED',403),
 SOURCE_INGRESS_NOT_ADMITTED:typedSourceGuidance('SOURCE_INGRESS_NOT_ADMITTED',403),
 RECOVERY_MIGRATION_REQUIRED:typedSourceGuidance('RECOVERY_MIGRATION_REQUIRED',503),
 SOURCE_FIELDS_INVALID:{status:400,title:'Source details need correction',remedy:'Check the listed fields against the source evidence, edit the draft, then explicitly save the corrected details.'},
 SOURCE_REVISION_CONFLICT:{status:409,title:'Source revision changed',remedy:'Refresh the current source revision and compare it with your retained draft before saving a correction.'},
 STALE_STATE:{status:409,title:'Payable version changed',remedy:'Refresh the current payable version and compare its source with your retained draft before saving a correction.'},
 DUPLICATE_SOURCE_IDENTITY:{status:409,title:'Source already recorded',remedy:'Choose the existing payable and correct its source where needed; do not create a duplicate.'},
 IMPORTED_SOURCE_REQUIRES_CORRECTION:{status:409,title:'Imported source needs a correction',remedy:'Choose the existing imported payable and save a correction in its own source history.'},
 SOURCE_REQUEST_CONFLICT:{status:409,title:'Original source request differs',remedy:'Read back the original request before another action. Keep its identity and reconcile changed source details explicitly.'},
 SOURCE_CONFLICT:{status:409,title:'Source changed while saving',remedy:'Refresh committed source status and compare your retained draft before another explicit correction.'},
 SOURCE_HISTORY_LIMIT:{status:409,title:'Source history limit reached',remedy:'Ask the workspace owner to review source history. Keep the draft and original request; refreshing does not reset the limit.'},
 SOURCE_HISTORY_CAPACITY:{status:409,title:'Source history capacity reached',remedy:'Ask the workspace owner to review source capacity. Keep the draft and original request; do not discard history.'},
} as const;
const labels:Record<string,string>={fields:'Source details',expected_revision:'Source revision',expected_version:'Payable version',reason:'Correction or entry reason',
 'fields.kind':'Source type','fields.supplier_name':'Supplier name','fields.invoice_number':'Invoice number','fields.invoice_issue_date':'Invoice issue date','fields.payment_terms':'Payment terms','fields.due_date':'Due date','fields.description':'Description','fields.amount':'Exact amount','fields.currency':'Source currency','fields.payer_circle_wallet_id':'Payer Circle Wallet ID','fields.service_reference':'Service reference','fields.purpose':'Recharge purpose','fields.service_date':'Service date','fields.evidence':'Evidence references'};
const decorationKeys=['code','title','reason','consequence','owner','remedy','resume'];
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function fieldLabel(value:string):string|undefined {
 if(Object.hasOwn(labels,value))return labels[value];
 const match=/^fields\.evidence\.(0|[1-9][0-9]?)\.(evidence_id|content_sha256)$/.exec(value);
 if(!match||Number(match[1])>=16)return undefined;
 return `${match[2]==='evidence_id'?'Evidence reference':'Evidence SHA256'}${match[1]==='0'?'':` ${Number(match[1])+1}`}`;
}
export type SourceCommandError={code:string;title:string;fieldLabels:string[];remedy:string;owner?:string};
export function sourceCommandError(path:string,method:string,target:string,status:number,data:unknown):SourceCommandError|null {
 if(!isSourceCommand(path,method,target)||!object(data)||!Object.hasOwn(data,'code')||typeof data.code!=='string'||!Object.hasOwn(guidance,data.code))return null;
 const code=data.code as keyof typeof guidance,rule=guidance[code];
 if(code==='IMPORTED_SOURCE_REQUIRES_CORRECTION'&&method!=='POST'||code==='STALE_STATE'&&method!=='PATCH')return null;
 if(status!==rule.status||Object.keys(data).some(k=>!['code','fields','stage2_status','remedy'].includes(k)))return null;
 // Existing assessment decoration is ignored, never stronger source evidence.
 const decoration=data.stage2_status;
 if(Object.hasOwn(data,'stage2_status')&&(!object(decoration)||Object.keys(decoration).some(k=>!decorationKeys.includes(k)||typeof decoration[k]!=='string'||(decoration[k]as string).length>2048)))return null;
 if(Object.hasOwn(data,'remedy')&&(typeof data.remedy!=='string'||data.remedy.length>4096))return null;
 const fieldLabels:string[]=[];
 if(code==='SOURCE_FIELDS_INVALID'){
  if(!Object.hasOwn(data,'fields')||!Array.isArray(data.fields)||data.fields.length<1||data.fields.length>64)return null;
  for(const issue of data.fields){
   if(!object(issue)||Object.keys(issue).some(k=>!['field','message'].includes(k))||!Object.hasOwn(issue,'field')||typeof issue.field!=='string'||!Object.hasOwn(issue,'message')||typeof issue.message!=='string')return null;
   // Never render raw validator messages or unrecognized/oversized paths.
   const label=issue.field.length<=96?fieldLabel(issue.field):undefined;
   if(label&&!fieldLabels.includes(label)&&fieldLabels.length<12)fieldLabels.push(label);
  }
 }else if(Object.hasOwn(data,'fields'))return null;
 return{code,title:rule.title,fieldLabels,remedy:rule.remedy,...('owner'in rule?{owner:rule.owner}:{})};
}
export const sourceSaveUnconfirmed='Source save completion not confirmed. Keep the draft and original request identity; read committed source status before another action. Do not resend automatically.';
