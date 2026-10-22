/** Fixed login lifetime; validation never renews it. Safe for browser imports. */
export const OPERATOR_SESSION_DURATION_MS = 7_200_000;
export const OPERATOR_SESSION_REVALIDATION_MS = 3_600_000;
export const OPERATOR_SESSION_CHECK_DEADLINE_MS = 10_000;
