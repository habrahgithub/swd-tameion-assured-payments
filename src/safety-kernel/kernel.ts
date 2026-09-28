import type { AuthorityAggregate } from "../authority/aggregate";
import type { AuthorityStore } from "../authority/aggregate";
import { verifyAtomicRoundtrip } from "../domain/numeric";
import type { ControlResult } from "../domain/schemas";
import { REQUIRED_CONTROL_IDS_P0 } from "../domain/schemas";

export const SAFETY_KERNEL_VERSION = "SK-P0-1";

export interface SafetyKernelResult {
  controlResults: ControlResult[];
  overall: "PASS" | "HOLD" | "BLOCK";
}

/**
 * Deterministic P0 Safety Kernel: evaluates the exact required control set
 * (Durable Assurance Record Schema) against the current authority
 * aggregate. This is pure/deterministic — no AI model is in this path.
 * Overall PASS only when every required control is PASS; any HOLD/BLOCK
 * makes the whole assessment non-sealable.
 */
export function runSafetyKernel(aggregate: AuthorityAggregate, store: AuthorityStore): SafetyKernelResult {
  const controls: ControlResult[] = [];

  const pass = (control_id: (typeof REQUIRED_CONTROL_IDS_P0)[number]): ControlResult => ({
    control_id,
    result: "PASS",
    finding_code: "NONE",
  });
  const fail = (
    control_id: (typeof REQUIRED_CONTROL_IDS_P0)[number],
    result: "HOLD" | "BLOCK",
    finding_code: string,
  ): ControlResult => ({ control_id, result, finding_code });

  // SK-IDENTITY-ORG: organization_id is bound and non-empty.
  controls.push(
    aggregate.organization_id.length > 0 ? pass("SK-IDENTITY-ORG") : fail("SK-IDENTITY-ORG", "BLOCK", "ORG-005"),
  );

  // SK-FINANCIAL-AUTHORITY: obligation must have completed the T1 approval transition.
  controls.push(
    aggregate.state === "AUTHORIZED" ? pass("SK-FINANCIAL-AUTHORITY") : fail("SK-FINANCIAL-AUTHORITY", "BLOCK", "AUT-003"),
  );

  // SK-COUNTERPARTY-TRUST: counterparty must be current and payment-eligible.
  controls.push(
    aggregate.counterparty_status === "VERIFIED"
      ? pass("SK-COUNTERPARTY-TRUST")
      : fail("SK-COUNTERPARTY-TRUST", "BLOCK", "CTR-003"),
  );

  // SK-DESTINATION-TRUST: destination must be VERIFIED + ACTIVE.
  controls.push(
    aggregate.destination_verification_status === "VERIFIED" && aggregate.destination_operational_status === "ACTIVE"
      ? pass("SK-DESTINATION-TRUST")
      : fail("SK-DESTINATION-TRUST", "BLOCK", "DST-003"),
  );

  // SK-SOURCE-WALLET-AUTHORITY: source wallet must be the exact ACTIVE org wallet.
  controls.push(
    aggregate.source_wallet_status === "ACTIVE"
      ? pass("SK-SOURCE-WALLET-AUTHORITY")
      : fail("SK-SOURCE-WALLET-AUTHORITY", "BLOCK", "WDG-008"),
  );

  // SK-AMOUNT-ATOMIC-EXACT: authoritative decimal -> atomic roundtrip must be exact.
  try {
    verifyAtomicRoundtrip(aggregate.amount, 6);
    controls.push(pass("SK-AMOUNT-ATOMIC-EXACT"));
  } catch {
    controls.push(fail("SK-AMOUNT-ATOMIC-EXACT", "BLOCK", "NUM-006"));
  }

  // SK-ASSET-NETWORK: asset/network must be the exact allowed execution rail.
  controls.push(
    aggregate.asset === "USDC" && aggregate.network === "ARC_TESTNET"
      ? pass("SK-ASSET-NETWORK")
      : fail("SK-ASSET-NETWORK", "BLOCK", "EXE-010"),
  );

  // SK-STATE-CURRENTNESS: no business hold / security freeze blocking authorization.
  controls.push(
    !aggregate.business_hold && !aggregate.security_freeze
      ? pass("SK-STATE-CURRENTNESS")
      : fail("SK-STATE-CURRENTNESS", "HOLD", "OPS-001"),
  );

  // SK-DUPLICATE-EXTERNAL-SETTLEMENT: no prior/duplicate settlement state.
  controls.push(
    aggregate.external_settlement_state === "NONE"
      ? pass("SK-DUPLICATE-EXTERNAL-SETTLEMENT")
      : fail("SK-DUPLICATE-EXTERNAL-SETTLEMENT", "BLOCK", "OPS-005"),
  );

  // SK-KILL-SWITCH: global/org/transaction kill switch must allow authorization.
  controls.push(
    !store.isKillSwitchActive("GLOBAL_EXECUTION_DISABLED") &&
      !store.isKillSwitchActive(`ORG:${aggregate.organization_id}`) &&
      !store.isKillSwitchActive(`TXN:${aggregate.obligation_id}`)
      ? pass("SK-KILL-SWITCH")
      : fail("SK-KILL-SWITCH", "BLOCK", "WDG-001"),
  );

  const overall: SafetyKernelResult["overall"] = controls.some((c) => c.result === "BLOCK")
    ? "BLOCK"
    : controls.some((c) => c.result === "HOLD")
      ? "HOLD"
      : "PASS";

  return { controlResults: controls, overall };
}
