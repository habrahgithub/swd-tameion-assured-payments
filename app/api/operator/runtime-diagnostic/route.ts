import { runtimeDiagnosticHandler } from "../../../../src/server/operator-runtime-diagnostic";
import { methodNotAllowed } from "../../../../src/server/route-access-policy";

export const GET = runtimeDiagnosticHandler;
export const POST = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
