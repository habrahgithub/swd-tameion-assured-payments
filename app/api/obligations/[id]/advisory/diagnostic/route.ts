import {genuineAssessmentObservationHandler} from '../../../../../../src/server/genuine-assessment-observation';
import {methodNotAllowed} from '../../../../../../src/server/route-access-policy';

export async function POST(request:Request,context:{params:Promise<{id:string}>}){return genuineAssessmentObservationHandler(request,(await context.params).id);}
export const GET=methodNotAllowed;
export const HEAD=methodNotAllowed;
export const OPTIONS=methodNotAllowed;
export const PUT=methodNotAllowed;
export const PATCH=methodNotAllowed;
export const DELETE=methodNotAllowed;
export const maxDuration=30;
