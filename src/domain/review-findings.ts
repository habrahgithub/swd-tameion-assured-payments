import type {z} from 'zod';
import type {reviewInputSchema} from './review-decision';
/** These concerns admit scoped judgment. Factual source, currency, trust and
 * evidence-integrity failures require their actual correction paths. */
export const HUMAN_ADVISORY_CODES=new Set(['POTENTIAL_DUPLICATE','OTHER_REQUIRES_HUMAN_REVIEW','PROVIDER_UNAVAILABLE','MODEL_OUTPUT_INVALID']);
export function humanFindingDispositionsValid(input:z.infer<typeof reviewInputSchema>,findings:readonly {code:string}[],evidenceIds:ReadonlySet<string>):boolean {
 const dispositions=input.finding_dispositions;
 if(new Set(dispositions.map(d=>d.finding_code)).size!==dispositions.length||dispositions.some(d=>!findings.some(f=>f.code===d.finding_code)||d.evidence_ids.some(e=>!evidenceIds.has(e))))return false;
 if(input.decision!=='ACCEPT_FOR_AUTHORIZATION')return true;
 return findings.every(f=>HUMAN_ADVISORY_CODES.has(f.code)&&dispositions.some(d=>d.finding_code===f.code&&d.disposition==='ACCEPT_ADVISORY'));
}
