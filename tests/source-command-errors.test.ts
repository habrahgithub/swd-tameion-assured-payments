import {expect,it} from 'vitest';
import {isSourceCommand,sourceCommandError,sourceSaveUnconfirmed} from '../src/client/source-command-errors';
import {stage2Status} from '../src/domain/assessment-status';
const target='SYNTHETIC/TARGET',path=`/api/obligations/${encodeURIComponent(target)}`;
const fields=(field='fields.amount')=>({code:'SOURCE_FIELDS_INVALID',fields:[{field,message:'SYNTHETIC_PRIVATE_RAW_SQL_OR_INPUT'}]});
const present=(data:unknown,status=400,route=path,method='PATCH')=>sourceCommandError(route,method,target,status,data);
it('matches only exact source commands for the current target',()=>{
 expect(isSourceCommand('/api/obligations','POST',target)).toBe(true);expect(isSourceCommand(path,'PATCH',target)).toBe(true);
 for(const[route,method,id]of [[path+'?x=1','PATCH',target],[path+'/advisory','POST',target],[path+'/review','POST',target],[path+'/approve','POST',target],[path+'/successor','POST',target],['/api/internal/demo/real-testnet-payment/preflight','POST',target],['/api/obligations/OTHER','PATCH',target],['/api/obligations/','PATCH',''],['/api/obligations?new=1','POST',target],[path,'patch',target],[path,'GET',target],['/api/obligations','PATCH',target]]){expect(isSourceCommand(route,method,id)).toBe(false);expect(sourceCommandError(route,method,id,400,fields())).toBeNull();}
});
for(const[code,status,title,method]of [
 ['SOURCE_FIELDS_INVALID',400,'Source details need correction','PATCH'],['SOURCE_REVISION_CONFLICT',409,'Source revision changed','PATCH'],['STALE_STATE',409,'Payable version changed','PATCH'],['DUPLICATE_SOURCE_IDENTITY',409,'Source already recorded','POST'],['IMPORTED_SOURCE_REQUIRES_CORRECTION',409,'Imported source needs a correction','POST'],['SOURCE_REQUEST_CONFLICT',409,'Original source request differs','PATCH'],['SOURCE_CONFLICT',409,'Source changed while saving','PATCH'],['SOURCE_HISTORY_LIMIT',409,'Source history limit reached','POST'],['SOURCE_HISTORY_CAPACITY',409,'Source history capacity reached','POST']
]as const)it(`canonical ${code}/${status} has static field/remedy guidance`,()=>{
 const data=code==='SOURCE_FIELDS_INVALID'?fields():{code,stage2_status:stage2Status(code)};
 const result=sourceCommandError(method==='POST'?'/api/obligations':path,method,target,status,data)!;expect(result.title).toBe(title);expect(result.code).toBe(code);expect(result.remedy.length).toBeGreaterThan(20);expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PRIVATE|Assessment|provider|unprocessed/);
 expect(sourceCommandError(method==='POST'?'/api/obligations':path,method,target,status===400?409:400,data)).toBeNull();
});
it('uses finite own field labels, deduplicates and never renders raw validator content',()=>{
 const names=['fields.supplier_name','fields.invoice_number','fields.invoice_issue_date','fields.payment_terms','fields.due_date','fields.description','fields.amount','fields.currency','fields.payer_circle_wallet_id'];
 const result=present({...fields(),fields:names.map(field=>({field,message:'SYNTHETIC_PRIVATE_RAW_SQL_OR_INPUT'}))})!;
 expect(result.fieldLabels).toEqual(['Supplier name','Invoice number','Invoice issue date','Payment terms','Due date','Description','Exact amount','Source currency','Payer Circle Wallet ID']);
 for(const field of ['__proto__','constructor','toString','fields.__proto__','SYNTHETIC_PRIVATE_PATH','x'.repeat(1000),'fields.evidence.16.evidence_id','fields.evidence.01.evidence_id','fields.evidence.-1.evidence_id'])expect(present(fields(field))?.fieldLabels).toEqual([]);
 expect(present({...fields(),fields:[{field:'fields.amount',message:'private'},{field:'fields.amount',message:'private'}]})?.fieldLabels).toEqual(['Exact amount']);
 expect(present(fields('fields.evidence.15.content_sha256'))?.fieldLabels).toEqual(['Evidence SHA256 16']);expect(present(fields('fields.evidence.0.evidence_id'))?.fieldLabels).toEqual(['Evidence reference']);
 expect(present(fields('fields.service_reference'))?.fieldLabels).toEqual(['Service reference']);expect(present(fields('fields.purpose'))?.fieldLabels).toEqual(['Recharge purpose']);expect(present(fields('fields.service_date'))?.fieldLabels).toEqual(['Service date']);
 const all=[...names,'fields.evidence','fields.kind','reason','expected_revision','expected_version'];expect(present({...fields(),fields:all.map(field=>({field,message:'private'}))})?.fieldLabels).toHaveLength(12);
});
it('malformed, conflicting, uncertain and inherited payloads never acquire source rejection guidance',()=>{
 const bad:unknown[]=[null,[],{},'SOURCE_FIELDS_INVALID',{code:'constructor'},Object.create({code:'SOURCE_FIELDS_INVALID',fields:[]}),{code:'SOURCE_FIELDS_INVALID'},{...fields(),fields:[]},{...fields(),fields:Array(65).fill({field:'fields.amount',message:'private'})},{...fields(),fields:[null]},{...fields(),fields:[{field:42,message:'private'}]},{...fields(),fields:[{field:'fields.amount',message:{private:true}}]},{...fields(),fields:[{field:'fields.amount',message:'private',committed:true}]},{...fields(),committed:true},{...fields(),status:'UNKNOWN'},{...fields(),assessment_hash:'a'.repeat(64)},{...fields(),execution:{status:'SETTLED'}},{...fields(),stage2_status:'private'},{...fields(),stage2_status:{code:'UNKNOWN',committed:true}},{...fields(),remedy:{private:true}},{code:'SOURCE_CONFLICT',fields:[]},{code:'COMMIT_OUTCOME_UNVERIFIED'},{code:'PRIVATE_EXCEPTION'}];
 for(const data of bad)expect(present(data)).toBeNull();
 for(const status of [200,201,202,401,403,404,422,500,503])expect(present(fields(),status)).toBeNull();
 expect(sourceCommandError('/api/obligations','POST',target,409,{code:'STALE_STATE'})).toBeNull();expect(present({code:'IMPORTED_SOURCE_REQUIRES_CORRECTION'},409)).toBeNull();
 expect(JSON.stringify(present({...fields(),remedy:'SYNTHETIC_PRIVATE_REMEDY'}))).not.toContain('SYNTHETIC_PRIVATE');expect(sourceSaveUnconfirmed).toMatch(/original request identity/);expect(sourceSaveUnconfirmed).not.toMatch(/not processed|not submitted|not saved|safe to retry/i);
});
