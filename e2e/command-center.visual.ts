import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const obligation = {
  obligation_id: "OBL-UAT-01",
  service_category: "SOFTWARE_SERVICES",
  amount: "125.00",
  currency: "USD",
  recurrence: "MONTHLY",
  due_date: "2026-10-05",
  commercial_terms: "Net 30",
  assessed: true,
  decision: "PAY",
  provider_mode: "NOT_LIVE_AI",
  route_assurance_status: "Route assurance not ready",
};
const secondObligation = { ...obligation, obligation_id: "OBL-UAT-02", amount: "40.00", due_date: "2026-10-10" };
const proxiedObligation = { ...obligation, obligation_id: "OBL-UAT-03", amount: "125.00", due_date: "2026-10-15" };
const queueItem = (page: Page, id: string) => page.locator(`button[data-obligation-id="${id}"]`);
const mobileQueueToggle = (page: Page) => page.getByRole("complementary").getByRole("button", { name: /^(?:Choose an obligation|Switch obligation(?: ·.*)?)$/ });
async function openMobileQueue(page: Page) {
  await expect.poll(() => mobileQueueToggle(page).count()).toBe(1);
  const toggle = mobileQueueToggle(page);
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}

async function expandLifecycleStages(page: Page) {
  const disclosure = page.getByRole("button", { name: "View all stages", exact: true });
  if (await disclosure.count() && await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
}

async function collapseLifecycleStages(page: Page) {
  const disclosure = page.getByRole("button", { name: "View all stages", exact: true });
  if (await disclosure.count() && await disclosure.getAttribute("aria-expanded") === "true") await disclosure.click();
}

test("genuine first view keeps the payable, current stage, reason and legal next action in the initial viewport", async ({ page }, testInfo) => {
  const listResponse = await page.request.get("/api/obligations");
  expect(listResponse.ok()).toBe(true);
  const list = await listResponse.json() as { obligations: Array<Record<string, any>> };
  const first = list.obligations[0];
  expect(first).toBeTruthy();
  const detailResponse = await page.request.get(`/api/obligations/${first.obligation_id}`);
  expect(detailResponse.ok()).toBe(true);
  const expected = await detailResponse.json() as Record<string, any>;
  expect(expected.current_assessment).toBeNull();

  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  const assertGenuineFirstView = async (viewportHeight: number, mobile = false) => {
    await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText(`${expected.record.amount} ${expected.record.currency}`);
    await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
    await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" })).toHaveCount(0);
    await expect(page.getByText("Payment journey")).toHaveCount(0);
    await expect(page.getByText(/Activity & evidence/)).toHaveCount(0);
    await expect(page.getByText("Developer & audit evidence")).toHaveCount(0);
    await expect(page.getByText("Demo tools", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Operational Report/)).toHaveCount(0);
    const funding = page.getByRole("region", { name: "Wallet funding and payment readiness" });
    await expect(funding).toContainText("USDC funding: NOT VERIFIED");
    const balanceRefresh = funding.getByRole("button", { name: "Refresh Wallet Balance" });
    await expect(balanceRefresh).toBeVisible();
    await expect(balanceRefresh).toBeDisabled();
    await expect(balanceRefresh).toContainText("AUTH_GATE_UNVERIFIED");
    expect(await balanceRefresh.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("current-next-step")).not.toContainText(/Safety Kernel|PAE|provider|reconciliation/i);
    await expect(page.getByTestId("current-next-step")).toContainText("Run AI Assessment");
    await expect(page.getByTestId("current-next-step")).toContainText("This obligation needs an assessment before it can proceed.");
    await expect(page.getByTestId("current-next-step")).toContainText("AI can recommend PAY, HOLD or ESCALATE. It cannot approve payment or move money.");
    await expect(page.getByRole("button", { name: "Run AI Assessment" })).toBeVisible();
    await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(1);
    const queueRows = page.locator('button[data-obligation-id]');
    for (const row of await queueRows.all()) {
      await expect(row).not.toContainText(/Sole PAY candidate|route assurance|PAE|execution|provider/i);
    }

    await expect(page.getByText("Demonstrations", { exact: true })).toHaveCount(0);

    const selectedCard = page.getByRole("region", { name: "Selected source obligation" });
    const stageCard = page.getByTestId("current-next-step");
    const primary = page.getByRole("button", { name: "Run AI Assessment" });
    const sourceContext = selectedCard.getByTestId("source-service-context");
    const expectedBusinessName = expected.record.beneficiary_name && expected.record.beneficiary_name !== "Not captured"
      ? expected.record.beneficiary_name
      : String(first.service_category).replaceAll("_", " ").toLowerCase();
    await expect(selectedCard.locator("h2")).toHaveText(expectedBusinessName);
    await expect(selectedCard).not.toContainText(expected.record.obligation_id);
    await expect(sourceContext).toContainText(expected.record.commercial_terms);
    await expect(stageCard.locator("p").first()).toContainText("This obligation needs an assessment before it can proceed.");
    const firstViewport = await Promise.all([
      selectedCard.locator("h2").evaluate((element) => element.getBoundingClientRect().bottom),
      sourceContext.evaluate((element) => element.getBoundingClientRect().bottom),
      stageCard.locator("h3").evaluate((element) => element.getBoundingClientRect().bottom),
      stageCard.locator("p").nth(1).evaluate((element) => element.getBoundingClientRect().bottom),
      primary.evaluate((element) => element.getBoundingClientRect().bottom),
    ]);
    expect(firstViewport.every((bottom) => bottom <= viewportHeight), JSON.stringify(firstViewport)).toBe(true);
    const actionBounds = await primary.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      scrollY: window.scrollY,
    }));
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    console.log("GENUINE_OBLIGATION_FIRST_VIEWPORT", JSON.stringify({
      viewport: await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: window.innerHeight })),
      obligationId: expected.record.obligation_id,
      businessName: expectedBusinessName,
      state: "unassessed · source OUTSTANDING",
      actionLabel: "Run AI Assessment",
      actionCount: await page.locator('main button[data-primary-action="true"]:not(:disabled)').count(),
      actionBounds,
      scrollY: actionBounds.scrollY,
      disclosureOpen: await page.getByRole("main").locator("details[open]").count() > 0,
      navigationMutationCount: writes.length,
      documentWidth: widths.document,
    }));
  };

  await page.setViewportSize({ width: 1173, height: 751 });
  await page.goto("/");
  await expect(page.getByRole("main").locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toHaveCount(0);
  await queueItem(page, first.obligation_id).click();
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await assertGenuineFirstView(751);
  await page.screenshot({ path: testInfo.outputPath("genuine-desktop-first-view.png") });

  const fifthResponse = await page.request.get("/api/obligations/OBL-J0C-005");
  expect(fifthResponse.ok()).toBe(true);
  const fifth = await fifthResponse.json() as Record<string, any>;
  await page.locator('button[data-obligation-id="OBL-J0C-005"]').click();
  const fifthSource = page.getByRole("region", { name: "Selected source obligation" });
  await expect(fifthSource.getByTestId("source-service-context")).toContainText(fifth.record.commercial_terms);
  await expect(fifthSource.getByTestId("source-service-context")).toContainText("email invoice excerpt");
  await expect(page.getByRole("button", { name: "Run AI Assessment" })).toBeVisible();
  await expect(page.getByTestId("current-next-step")).toContainText("This obligation needs an assessment before it can proceed.");
  const fifthDesktopBounds = await Promise.all([
    fifthSource.locator("h2").evaluate((element) => element.getBoundingClientRect().bottom),
    fifthSource.getByTestId("source-service-context").evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByTestId("current-next-step").locator("h3").evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByTestId("current-next-step").locator("p").first().evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByRole("button", { name: "Run AI Assessment" }).evaluate((element) => element.getBoundingClientRect().bottom),
  ]);
  expect(fifthDesktopBounds.every((bottom) => bottom <= 760), JSON.stringify(fifthDesktopBounds)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("genuine-desktop-source-context-005.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("main").locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(0);
  await openMobileQueue(page);
  await queueItem(page, first.obligation_id).click();
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await assertGenuineFirstView(844, true);
  await page.screenshot({ path: testInfo.outputPath("genuine-mobile-first-view.png") });
  await openMobileQueue(page);
  await page.locator('button[data-obligation-id="OBL-J0C-005"]').click();
  const fifthMobileSource = page.getByRole("region", { name: "Selected source obligation" });
  await expect(fifthMobileSource.getByTestId("source-service-context")).toContainText(fifth.record.commercial_terms);
  await expect(fifthMobileSource.getByTestId("source-service-context")).toContainText("email invoice excerpt");
  await expect(page.getByRole("button", { name: "Run AI Assessment" })).toBeVisible();
  await expect(page.getByTestId("current-next-step")).toContainText("This obligation needs an assessment before it can proceed.");
  const fifthMobileBounds = await Promise.all([
    fifthMobileSource.locator("h2").evaluate((element) => element.getBoundingClientRect().bottom),
    fifthMobileSource.getByTestId("source-service-context").evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByTestId("current-next-step").locator("h3").evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByTestId("current-next-step").locator("p").first().evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByRole("button", { name: "Run AI Assessment" }).evaluate((element) => element.getBoundingClientRect().bottom),
  ]);
  expect(fifthMobileBounds.every((bottom) => bottom <= 844), JSON.stringify(fifthMobileBounds)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("genuine-mobile-source-context-005.png") });
  expect(writes).toEqual([]);
});

const detail = {
  truth: {
    source_truth: {
      role: "SOURCE_OF_RECORD",
      source: { source_kind: "DIRECT_EVIDENCE", source_system_id: "UAT-SOURCE", record_type: "BUSINESS_OBLIGATION", record_id: "UAT-INV-01", record_version: "1", approval_state: "NOT_ASSERTED", execution_authority: "NONE" },
      obligation_state: "OUTSTANDING",
    },
    tameion_control_truth: { role: "ASSURED_PAYMENT_CONTROL_PLANE", aggregate_version: 1, aggregate_state: "APPROVAL_PENDING", assessment_state: "ASSESSED", pae_state: "UNUSED", pae_sealed: false, execution_state: "NONE", execution_kill_switched: false, execution_release_authority: "NOT_GRANTED" },
    settlement_truth: { role: "SETTLEMENT_PROVIDER", provider_target: "CIRCLE_DCW", network: "ARC_TESTNET", runtime: "SIMULATED", status: "NOT_SUBMITTED", provider_ref: null, settlement_amount: "125.000000", settlement_atomic_amount: "125000000", source_amount: "125.00", source_currency: "USD", settlement_conversion_rate: null },
  },
  aggregate: { aggregate_version: 1, state: "APPROVAL_PENDING", amount: "125.000000", asset: "USDC", network: "ARC_TESTNET", destination_address: "0x1111111111111111111111111111111111111111", destination_verification_status: "PENDING_VERIFICATION", destination_operational_status: "ON_HOLD", source_wallet_ref: "UAT-WALLET", source_wallet_status: "INACTIVE", product_trust_provenance: "UNVERIFIED_CURRENT_TRUST", execution_state: "NONE", pae_state: "UNUSED" },
  record: { obligation_id: "OBL-UAT-01", amount: "125.00", currency: "USD", due_date: "2026-10-05", issue_date: "2026-09-01", commercial_terms: "Net 30" },
  current_assessment: { obligation_id: "OBL-UAT-01", assessment_id: "ASM-UAT-01", assessment_hash: "a".repeat(64), aggregate_version: "1", decision: "PAY", reasons: ["No validated blocker was found; existing deterministic authorization and Safety Kernel gates still apply."], provider_mode: "NOT_LIVE_AI" },
  demo_arc_trust_simulated: false,
  pae_sealed: false,
  execution: null,
  execution_kill_switched: false,
};

function detailFor(obligationId: string, sourceAmount: string, dueDate: string, sourceRecordId: string) {
  const [whole, fraction = ""] = sourceAmount.split(".");
  const atomicAmount = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
  const settlementAmount = `${whole}.${fraction.padEnd(6, "0")}`;
  return {
    ...detail,
    truth: {
      ...detail.truth,
      tameion_control_truth: { ...detail.truth.tameion_control_truth },
      source_truth: { ...detail.truth.source_truth, source: { ...detail.truth.source_truth.source, record_id: sourceRecordId } },
      settlement_truth: { ...detail.truth.settlement_truth, settlement_amount: settlementAmount, settlement_atomic_amount: atomicAmount, source_amount: sourceAmount },
    },
    aggregate: { ...detail.aggregate, amount: settlementAmount },
    record: { ...detail.record, obligation_id: obligationId, amount: sourceAmount, due_date: dueDate },
    current_assessment: { ...detail.current_assessment, obligation_id: obligationId, assessment_id: `ASM-${obligationId}`, assessment_hash: "b".repeat(64) },
  };
}

function detailWithProxy(): Record<string, any> {
  const source = detailFor("OBL-UAT-03", "125.00", "2026-10-15", "UAT-INV-03");
  return {
    ...source,
    settlement_proxy: {
      source_aggregate_version: 1,
      mapped_aggregate_version: 2,
      preflight: {
        profile: "circle-arc-testnet",
        organization_id: "ORG-UAT",
        obligation_id: "OBL-UAT-03",
        source_amount: "125.00",
        source_currency: "USD",
        amount: "125.000000",
        asset: "USDC",
        network: "ARC_TESTNET",
        source_wallet: { id: "UAT-ARC-SOURCE", address: "0x1111111111111111111111111111111111111111" },
        destination_wallet: { id: "UAT-ARC-PROXY", address: "0x2222222222222222222222222222222222222222", name: "Arc Testnet settlement proxy" },
        captured_at: "2026-10-06T18:00:00.000Z",
        evidence_sha256: "c".repeat(64),
        max_network_fee: "0.010000",
        estimated_network_fee: "0.001000",
        max_total_debit: "125.010000",
      },
    },
    aggregate: { ...source.aggregate, aggregate_version: 2, amount: "125.000000" },
  };
}

function proxyLifecycleDetail(status: "AUTHORIZED" | "SUBMITTED" | "UNKNOWN" | "SETTLED"): Record<string, any> {
  const source: Record<string, any> = detailWithProxy();
  source.record.obligation_id = "OBL-UAT-01";
  source.current_assessment.obligation_id = "OBL-UAT-01";
  source.current_assessment.aggregate_version = "2";
  source.settlement_proxy.preflight.obligation_id = "OBL-UAT-01";
  const settled = status === "SETTLED";
  const executionStatus = settled ? "SETTLED" : status === "AUTHORIZED" ? null : status;
  const settledIdempotencyKey = "idem-OBL-UAT-01-SETTLED";
  const settledAtomicAmount = "125000000";
  const settledDestination = source.settlement_proxy.preflight.destination_wallet.address;
  return {
    ...source,
    assurance_evidence: status === "AUTHORIZED" ? {
      state: "AVAILABLE_CURRENT_BINDING",
      assurance_id: "ASSURANCE-UAT",
      recorded_at: "2026-10-07T12:00:00.000Z",
      organization_id: "ORG-UAT",
      obligation_id: "OBL-UAT-01",
      aggregate_version: 2,
      policy_version: "policy-u1",
      approval_record_hash: "f".repeat(64),
      pae_instruction_hash: "d".repeat(64),
      assurance_hash: "a".repeat(64),
      overall: "PASS",
      control_results: ["approval", "amount", "destination", "expiry", "kill-switch", "organization", "obligation", "policy", "source-wallet", "currentness"].map((control_id) => ({ control_id, result: "PASS" })),
    } : undefined,
    truth: {
      ...source.truth,
      tameion_control_truth: {
        ...source.truth.tameion_control_truth,
        aggregate_state: settled ? "RECONCILED" : status === "UNKNOWN" ? "IN_DOUBT" : "AUTHORIZED",
        pae_state: settled ? "CONSUMED" : "SEALED",
        execution_state: executionStatus ?? "NONE",
        execution_release_authority: settled ? "CONSUMED" : status === "SUBMITTED" ? "SUBMITTED_TO_PROVIDER" : status === "UNKNOWN" ? "IN_DOUBT_PROVIDER_SUBMISSION" : "TAMEION_PAE_REVERIFY_REQUIRED",
      },
      settlement_truth: {
        ...source.truth.settlement_truth,
        runtime: settled ? "LIVE" : "SIMULATED",
        status: executionStatus ?? "NOT_SUBMITTED",
        provider_ref: executionStatus ? "MOCK-ARC-REFERENCE" : null,
      },
    },
    aggregate: {
      ...source.aggregate,
      state: settled ? "RECONCILED" : status === "UNKNOWN" ? "IN_DOUBT" : "AUTHORIZED",
      execution_state: executionStatus ?? "NONE",
      pae_state: settled ? "CONSUMED" : "SEALED",
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_status: "ACTIVE",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    },
    pae_sealed: true,
    execution_gate: status === "AUTHORIZED" ? "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION" : "LOCKED_AFTER_SUBMISSION",
    execution_packet: status === "AUTHORIZED" ? { packet_sha256: "e".repeat(64), packet: { obligation_id: "OBL-UAT-01" } } : settled ? {
      packet_sha256: "f".repeat(64),
      packet: {
        organization_id: "ORG-UAT",
        obligation_id: "OBL-UAT-01",
        aggregate_version: 2,
        settlement_amount: "125.000000",
        asset: "USDC",
        network: "ARC_TESTNET",
        provider_token: { decimals: 6 },
        circle_arc_execution_instruction: { amount: "125.000000", decimals: 6, destination_address: settledDestination },
        pae: { instruction_hash: "d".repeat(64), idempotency_key: settledIdempotencyKey },
      },
    } : null,
    sealed_pae_instruction_hash: "d".repeat(64),
    execution: executionStatus ? {
      status: executionStatus,
      provider_ref: "MOCK-ARC-REFERENCE",
      ...(settled ? {
        idempotency_key: settledIdempotencyKey,
        atomic_amount: settledAtomicAmount,
        destination_address: settledDestination,
        provider_evidence: {
          status: "CONFIRMED",
          atomic_amount: settledAtomicAmount,
          destination_address: settledDestination,
          reconciled_at: "2026-10-07T12:00:00.000Z",
        },
      } : {}),
    } : null,
  };
}

function postApprovalNPlusOneDetail(paeSealed: boolean): Record<string, any> {
  const approved = detailWithProxy();
  approved.record.obligation_id = "OBL-UAT-01";
  approved.truth.source_truth.source.record_id = "UAT-INV-01";
  approved.aggregate.aggregate_version = 3;
  approved.aggregate.state = "AUTHORIZED";
  approved.aggregate.pae_state = paeSealed ? "SEALED" : "UNUSED";
  approved.truth.tameion_control_truth.aggregate_version = 3;
  approved.truth.tameion_control_truth.aggregate_state = "AUTHORIZED";
  approved.truth.tameion_control_truth.assessment_state = "NOT_CURRENT";
  approved.truth.tameion_control_truth.pae_state = paeSealed ? "SEALED" : "UNUSED";
  approved.truth.tameion_control_truth.pae_sealed = paeSealed;
  approved.truth.tameion_control_truth.execution_state = "NONE";
  approved.truth.tameion_control_truth.execution_release_authority = paeSealed ? "TAMEION_PAE_REVERIFY_REQUIRED" : "NOT_GRANTED";
  approved.settlement_proxy.mapped_aggregate_version = 2;
  approved.current_assessment = null;
  approved.pae_sealed = paeSealed;
  approved.execution = null;
  approved.execution_packet = null;
  approved.execution_gate = paeSealed ? "LOCKED_UNTIL_CURRENT_AUTHORIZATION" : "LOCKED_AFTER_ASSURANCE_HOLD";
  approved.sealed_pae_instruction_hash = paeSealed ? "d".repeat(64) : null;
  return approved;
}

function liveWinnerForPreparation(): Record<string, any> {
  const candidate: Record<string, any> = detailFor("OBL-UAT-01", "125.00", "2026-10-05", "UAT-INV-01");
  candidate.current_assessment.provider_used = "mocked-test-provider";
  candidate.current_assessment.provider_mode = "LIVE_AI";
  candidate.current_assessment.race = {
    result: { decision: "PAY", decision_summary: "No validated blocker was found; existing deterministic authorization and Safety Kernel gates still apply.", validated_findings: [] },
    action_taken: { summary: "Required checks evaluated.", checks: ["Source identity", "Current obligation"] },
    caveats: { missing_context: [], uncertainty_signal: false, model_explanation: "Advisory fixture.", model_explanation_authority: "NON_AUTHORITATIVE" },
    evidence: {
      evidence_ids: ["UAT-EVIDENCE-1"],
      authoritative_facts: {
        obligation_id: "OBL-UAT-01", aggregate_version: "1", amount: "125.00", currency: "USD",
        due_date: null, due_date_status: "NOT_STATED_ON_SOURCE", due_date_position: "NOT_STATED",
        as_of_date: "2026-10-04", state_at_event_baseline: "OUTSTANDING", business_purpose_confirmed: true,
        source_evidence_present: true, destination_status: "PENDING_VERIFICATION",
      },
    },
    remediation: [], prompt_identity: { version: "uat-fixture-v1", sha256: "e".repeat(64) },
  };
  return candidate;
}

function postProxyFreshPayWithAggregateRevoked(): Record<string, any> {
  const candidate = liveWinnerForPreparation();
  const proxy = detailWithProxy();
  candidate.settlement_proxy = proxy.settlement_proxy;
  candidate.aggregate = {
    ...proxy.aggregate,
    aggregate_version: 2,
    state: "APPROVAL_PENDING",
    pae_state: "REVOKED",
    destination_verification_status: "VERIFIED",
    destination_operational_status: "ACTIVE",
    source_wallet_status: "ACTIVE",
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
  };
  candidate.current_assessment.aggregate_version = "2";
  candidate.current_assessment.race.evidence.authoritative_facts.aggregate_version = "2";
  candidate.truth.tameion_control_truth = {
    ...candidate.truth.tameion_control_truth,
    aggregate_version: 2,
    aggregate_state: "APPROVAL_PENDING",
    pae_state: "REVOKED",
    execution_state: "NONE",
    execution_release_authority: "REVOKED",
  };
  candidate.pae_sealed = false;
  candidate.execution = null;
  candidate.execution_packet = null;
  candidate.sealed_pae_instruction_hash = null;
  candidate.execution_gate = "LOCKED_UNTIL_CURRENT_AUTHORIZATION";
  return candidate;
}

async function openFixture(
  page: Page,
  selectedDetail: Record<string, any> = detail,
  queue: Array<Record<string, any>> = [obligation, secondObligation, proxiedObligation],
  detailById: Record<string, Record<string, any>> = {},
  solePayCandidateId?: string | null,
) {
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") unexpectedWrites.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/obligations") return route.fulfill({ json: {
      obligations: queue,
      assessed_count: queue.filter((item) => item.assessed).length,
      total_count: queue.length,
      sole_pay_candidate_id: solePayCandidateId === undefined
        ? queue.length === 3 ? "OBL-UAT-01" : null
        : solePayCandidateId,
    } });
    if (url.pathname.startsWith("/api/obligations/")) {
      const id = url.pathname.split("/").at(-1)!;
      const responseDetail = detailById[id] ?? (id === "OBL-UAT-01" ? selectedDetail
        : id === "OBL-UAT-02" ? detailFor("OBL-UAT-02", "40.00", "2026-10-10", "UAT-INV-02")
          : id === "OBL-UAT-03" ? detailWithProxy() : null);
      if (responseDetail) return route.fulfill({ json: responseDetail });
    }
    return route.fulfill({ status: 404, json: { error: "This read-only visual fixture does not permit action requests." } });
  });
  await page.goto("/");
  const selectedId = String(selectedDetail.record?.obligation_id ?? "OBL-UAT-01");
  const selectedRow = page.locator(`button[data-obligation-id="${selectedId}"]`);
  if (await page.evaluate(() => window.innerWidth <= 768)) {
    await openMobileQueue(page);
  }
  await expect(selectedRow).toBeVisible();
  await selectedRow.click();
  await expect(page.getByTestId("current-next-step").getByRole("heading")).not.toHaveText("Loading");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return unexpectedWrites;
}

async function actualSourcePayFixtures(page: Page) {
  const listResponse = await page.request.get("/api/obligations");
  expect(listResponse.ok()).toBe(true);
  const list = await listResponse.json() as { obligations: Array<Record<string, any>> };
  const sourceById: Record<string, Record<string, any>> = {};
  for (const id of ["OBL-J0C-001", "OBL-J0C-003"]) {
    const response = await page.request.get(`/api/obligations/${id}`);
    expect(response.ok()).toBe(true);
    sourceById[id] = await response.json();
    expect(sourceById[id].record.obligation_id).toBe(id);
  }

  const queue: Array<Record<string, any>> = list.obligations.map((source) => ({
    ...source,
    assessed: true,
    decision: source.obligation_id === "OBL-J0C-001" || source.obligation_id === "OBL-J0C-003" ? "PAY" : "HOLD",
    provider_mode: "LIVE_AI",
    ...(source.obligation_id === "OBL-J0C-001" ? { route_assurance_status: "Route assurance not ready" } : {}),
  }));
  expect(queue.find((item) => item.obligation_id === "OBL-J0C-001")?.decision).toBe("PAY");
  expect(queue.find((item) => item.obligation_id === "OBL-J0C-003")?.decision).toBe("PAY");

  const assessmentTemplate = liveWinnerForPreparation().current_assessment;
  const payDetailById = Object.fromEntries(Object.entries(sourceById).map(([id, source]) => {
    const current = structuredClone(source);
    const aggregateVersion = String(current.aggregate.aggregate_version);
    const assessment = structuredClone(assessmentTemplate);
    assessment.obligation_id = id;
    assessment.assessment_id = `ASM-${id}-VIEWPORT`;
    assessment.assessment_hash = `${id === "OBL-J0C-001" ? "a" : "b"}`.repeat(64);
    assessment.aggregate_version = aggregateVersion;
    assessment.reasons = ["The current assessment found no validated payment blocker; separate payment controls still apply."];
    assessment.race.result.decision_summary = assessment.reasons[0];
    assessment.race.evidence.authoritative_facts.obligation_id = id;
    assessment.race.evidence.authoritative_facts.aggregate_version = aggregateVersion;
    assessment.race.evidence.authoritative_facts.amount = current.record.amount;
    assessment.race.evidence.authoritative_facts.currency = current.record.currency;
    current.current_assessment = assessment;
    current.aggregate = {
      ...current.aggregate,
      state: "APPROVAL_PENDING",
      destination_verification_status: "PENDING_VERIFICATION",
      destination_operational_status: "ON_HOLD",
      source_wallet_status: "INACTIVE",
      product_trust_provenance: "UNVERIFIED_CURRENT_TRUST",
      execution_state: "NONE",
      pae_state: "UNUSED",
    };
    current.truth.tameion_control_truth = {
      ...current.truth.tameion_control_truth,
      aggregate_state: "APPROVAL_PENDING",
      assessment_state: "ASSESSED",
      pae_state: "UNUSED",
      pae_sealed: false,
      execution_state: "NONE",
      execution_release_authority: "NOT_GRANTED",
    };
    current.settlement_proxy = null;
    current.pae_sealed = false;
    current.execution = null;
    current.execution_packet = null;
    current.sealed_pae_instruction_hash = null;
    current.execution_gate = "LOCKED_UNTIL_CURRENT_AUTHORIZATION";
    current.execution_kill_switched = false;
    current.demo_arc_trust_simulated = false;
    return [id, current];
  }));

  return { queue, payDetailById, selectedCandidateId: "OBL-J0C-001" };
}

test("clerk Assessment result renders on desktop and mobile from a read-only producer-shaped detail", async ({ page }, testInfo) => {
  const result = liveWinnerForPreparation();
  result.current_assessment.provider_mode = "NOT_LIVE_AI";
  result.current_assessment.provider_used = "test-fixture-provider";
  const unexpectedWrites = await openFixture(page, result);

  const openAssessmentOnDesktop = async () => {
    await expandLifecycleStages(page);
    await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment" }).click();
    const card = page.getByRole("region", { name: "Assessment result" });
    await expect(card.getByRole("heading", { name: "Current stage: Assessment. Step 2 of 6." })).toBeVisible();
    await expect(card.getByTestId("assessment-provenance")).toContainText("Deterministic fallback · not live AI.");
    await expect(card).toContainText(result.current_assessment.race.result.decision_summary);
    await expect(card).toContainText("What this means");
    await expect(card).toContainText("What to do next");
    for (const check of result.current_assessment.race.action_taken.checks) await expect(card).toContainText(check);
    await expect(card).not.toContainText(result.current_assessment.assessment_id);
    await expect(card).not.toContainText(result.current_assessment.assessment_hash);
    await expect(card).not.toContainText("UAT-EVIDENCE-1");
    return card;
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopCard = await openAssessmentOnDesktop();
  const desktopReview = desktopCard.getByRole("button", { name: "Review current PAY assessment" });
  await expect(desktopReview).toBeVisible();
  await desktopReview.click();
  await expect(desktopCard.getByTestId("assessment-supporting-detail")).not.toHaveAttribute("open");
  await expect(desktopCard.getByRole("button", { name: "Run AI Assessment again" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("clerk-assessment-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("main").locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(0);
  await openMobileQueue(page);
  await queueItem(page, "OBL-UAT-01").click();
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.getByRole("button", { name: "View all stages", exact: true }).click();
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment" }).click();
  const mobileCard = page.getByRole("region", { name: "Assessment result" });
  await expect(mobileCard.getByRole("heading", { name: "Current stage: Assessment. Step 2 of 6." })).toBeVisible();
  await expect(mobileCard.getByTestId("assessment-provenance")).toContainText("Deterministic fallback · not live AI.");
  await expect(mobileCard).toContainText(result.current_assessment.race.result.decision_summary);
  await page.getByRole("button", { name: "Review current PAY assessment" }).click();
  await expect(mobileCard.getByTestId("assessment-supporting-detail")).not.toHaveAttribute("open");
  await expect(mobileCard.getByRole("button", { name: "Run AI Assessment again" })).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: testInfo.outputPath("clerk-assessment-mobile.png"), fullPage: true });
  expect(unexpectedWrites).toEqual([]);
});

test("Screens 2–6 render as truthful, read-only producer-shaped stages on desktop and mobile", async ({ browser }, testInfo) => {
  const authorized = proxyLifecycleDetail("AUTHORIZED");
  authorized.assurance_evidence = {
    state: "AVAILABLE_CURRENT_BINDING",
    assurance_id: "ASSURANCE-UAT",
    recorded_at: "2026-10-07T12:00:00.000Z",
    organization_id: "ORG-UAT",
    obligation_id: "OBL-UAT-01",
    aggregate_version: 2,
    policy_version: "policy-u1",
    approval_record_hash: "f".repeat(64),
    pae_instruction_hash: "d".repeat(64),
    assurance_hash: "a".repeat(64),
    overall: "PASS",
    control_results: ["approval", "amount", "destination", "expiry", "kill-switch", "organization", "obligation", "policy", "source-wallet", "currentness"].map((control_id) => ({ control_id, result: "PASS" })),
  };
  const settled = proxyLifecycleDetail("SETTLED");
  const scenarios = [
    { stage: "Assessment", detail: liveWinnerForPreparation(), file: "screen-2-assessment" },
    { stage: "Authorization", detail: authorized, file: "screen-3-authorization" },
    { stage: "Assurance", detail: authorized, file: "screen-4-assurance" },
    { stage: "Payment", detail: authorized, file: "screen-5-payment" },
    { stage: "Reconciliation", detail: settled, file: "screen-6-reconciliation" },
  ] as const;

  for (const viewport of [{ width: 1280, height: 1000, label: "desktop" }, { width: 390, height: 844, label: "mobile" }]) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport });
      const unexpectedWrites = await openFixture(page, scenario.detail);
      const stageButton = page.getByRole("button", { name: scenario.stage, exact: true });
      await expandLifecycleStages(page);
      await expect(stageButton).toBeVisible();
      await expect(stageButton).not.toBeDisabled();
      await stageButton.click();
      await collapseLifecycleStages(page);

      const main = page.getByRole("main");
      const primaryActions = main.locator('button[data-primary-action="true"]');
      expect(await primaryActions.count()).toBeLessThanOrEqual(1);
      await expect(main.locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(1);
      if (await primaryActions.count()) {
        expect(await primaryActions.first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
      const openedDetails = await main.locator("details[open]").allTextContents();
      expect(openedDetails.filter((text) => !text.includes("View all stages"))).toEqual([]);
      await expect(page.getByText("Activity & evidence", { exact: false })).toBeVisible();
      await expect(page.getByText("Developer & audit evidence", { exact: true }).locator("xpath=..")).not.toHaveAttribute("open");
      await expect(page.getByText("Demo tools", { exact: true }).locator("xpath=.." )).not.toHaveAttribute("open");
      for (const row of await main.locator('button[data-obligation-id]').all()) {
        await expect(row).toContainText(/\d[\d,.]*\s+(USD|AED)/);
        await expect(row).toContainText(/\d{4}-\d{2}-\d{2}|Not captured/);
        await expect(row).not.toContainText(/Sole PAY candidate|route assurance|PAE|execution|provider|assessment reasons|selected candidate|earliest effective due date/i);
      }

      const stageRegions = [
        "Assessment result",
        "Approver decision packet",
        "Deterministic assurance result",
        "Payment status",
        "Reconciliation receipt",
      ];
      const currentRegion = scenario.stage === "Assessment" ? "Assessment result"
        : scenario.stage === "Authorization" ? "Approver decision packet"
          : scenario.stage === "Assurance" ? "Deterministic assurance result"
            : scenario.stage === "Payment" ? "Payment status" : "Reconciliation receipt";
      for (const region of stageRegions) {
        await expect(page.getByRole("region", { name: region, exact: true })).toHaveCount(region === currentRegion ? 1 : 0);
      }
      await expect(page.getByRole("main").getByRole("region", { name: currentRegion, exact: true })).toHaveCount(1);

      if (scenario.stage === "Assessment") {
        await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("Capability boundary");
      } else if (scenario.stage === "Authorization") {
  await expect(page.getByRole("region", { name: "Approver decision packet" })).toContainText("Approved instruction is sealed for the Arc Testnet settlement proxy.");
        await expect(page.getByRole("region", { name: "Approver decision packet" })).toContainText("OUTSTANDING");
      } else if (scenario.stage === "Assurance") {
        await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toContainText("ASSURANCE PASSED");
        await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toContainText("Deterministic controls, not AI, grant or deny release authority.");
        await expect(page.getByRole("region", { name: "Arc Testnet assurance and payment gate" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Disable this obligation" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Re-enable" })).toHaveCount(0);
      } else if (scenario.stage === "Payment") {
        await expect(page.getByRole("region", { name: "Payment status" })).toContainText("No execution has been recorded for this instruction.");
        await expect(page.getByRole("region", { name: "Payment status" })).toContainText("Sealed");
        await expect(page.getByRole("region", { name: "Payment status" })).toContainText("Testnet proxy destination");
        const paymentControls = page.getByText("Payment stop controls", { exact: true });
        await expect(paymentControls.locator("xpath=.." )).not.toHaveAttribute("open");
        await paymentControls.click();
        await expect(page.getByRole("button", { name: "Disable this obligation" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Re-enable" })).toBeVisible();
        await paymentControls.click();
        await expect(paymentControls.locator("xpath=.." )).not.toHaveAttribute("open");
      } else {
        await expect(page.getByRole("region", { name: "Reconciliation receipt" })).toContainText("TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION");
        await expect(page.getByRole("region", { name: "Reconciliation receipt" })).toContainText("remains outstanding");
      }

      await page.screenshot({ path: testInfo.outputPath(`${scenario.file}-${viewport.label}.png`), fullPage: true });
      expect(unexpectedWrites).toEqual([]);
      await page.close();
    }
  }
});

test("SETTLED evidence classification stays explicit in native desktop/mobile receipt captures", async ({ browser }, testInfo) => {
  const verified = proxyLifecycleDetail("SETTLED");
  const unavailable = structuredClone(verified);
  delete unavailable.execution.provider_evidence;
  unavailable.execution_packet = null;
  const mismatch = structuredClone(verified);
  mismatch.execution.provider_evidence.destination_address = "0x1111111111111111111111111111111111111111";
  const cases = [
    { name: "unavailable", detail: unavailable, expected: "Recorded as SETTLED — reconciliation evidence unavailable", noSuccess: true },
    { name: "mismatch", detail: mismatch, expected: "Reconciliation evidence mismatch — review required", noSuccess: true },
    { name: "verified", detail: verified, expected: "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION", noSuccess: false },
  ] as const;
  const captures: Array<Record<string, unknown>> = [];

  for (const viewport of [
    { width: 1173, height: 751, label: "desktop-1173x751" },
    { width: 390, height: 844, label: "mobile-390x844" },
  ]) {
    for (const scenario of cases) {
      const page = await browser.newPage({ viewport });
      const writes = await openFixture(page, scenario.detail);
      await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
      await expandLifecycleStages(page);
      const stageNavigator = page.getByRole("navigation", { name: "Payment lifecycle navigation" });
      await expect(stageNavigator.getByRole("button", { name: "Reconciliation", exact: true })).toBeVisible();
      await stageNavigator.getByRole("button", { name: "Reconciliation", exact: true }).click();
      await collapseLifecycleStages(page);
      await page.evaluate(() => window.scrollTo(0, 0));

      const receipt = page.getByRole("region", { name: "Reconciliation receipt" });
      await expect(receipt).toContainText(scenario.expected);
      await expect(receipt).toContainText("OUTSTANDING · remains outstanding in the source record");
      await expect(page.getByRole("button", { name: /Execute Test Payment|Retry payment|Resubmit/i })).toHaveCount(0);
      await expect(page.getByRole("main").locator("details[open]")).toHaveCount(0);
      if (scenario.noSuccess) {
        await expect(page.getByRole("main")).not.toContainText(/TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i);
      } else {
        await expect(receipt).toContainText("Exact amount verificationconfirmed");
        await expect(receipt).toContainText("Exact destination verificationconfirmed");
      }

      const screenState = await page.evaluate(() => {
        const primary = [...document.querySelectorAll<HTMLElement>('main button[data-primary-action="true"]')];
        return {
          browser: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          disclosureOpen: document.querySelectorAll("main details[open]").length !== 0,
          primary: primary.map((element) => {
            const bounds = element.getBoundingClientRect();
            return { label: element.innerText, bounds: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right } };
          }),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(screenState.scrollY).toBe(0);
      expect(screenState.disclosureOpen).toBe(false);
      expect(screenState.primary.length).toBeLessThanOrEqual(1);
      expect(screenState.horizontalOverflow).toBe(false);
      const capture = {
        fixture: scenario.name,
        detailSource: "existing producer-shaped mocked detail route; proxyLifecycleDetail('SETTLED') with explicit evidence override",
        runtime: "LIVE read-model fixture label only; no live provider calls",
        font: "DejaVu Sans forced for audit geometry",
        ...screenState,
        navigationMutationCount: writes.length,
      };
      captures.push(capture);
      console.log("F7_SETTLED_EVIDENCE_CAPTURE", JSON.stringify(capture));
      await page.screenshot({
        path: testInfo.outputPath(`f7-${scenario.name}-${viewport.label}-scroll0-closed.png`),
        fullPage: false,
      });

      await receipt.getByText("View reconciliation evidence").click();
      await expect(receipt).toContainText(`Evidence classification${scenario.expected}`);
      if (scenario.name !== "verified") await expect(receipt).toContainText("Recorded ledger statusSETTLED");
      await page.screenshot({ path: testInfo.outputPath(`f7-${scenario.name}-${viewport.label}-evidence-open-full.png`), fullPage: true });
      const developerEvidence = page.getByText("Developer & audit evidence", { exact: true });
      await developerEvidence.click();
      await expect(page.getByRole("main")).toContainText(scenario.expected);
      await page.screenshot({ path: testInfo.outputPath(`f7-${scenario.name}-${viewport.label}-developer-evidence.png`), fullPage: true });
      const additional = page.getByText("Additional tools", { exact: true });
      await additional.click();
      await page.getByRole("button", { name: "Operational Report (secondary)" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const reportState = await page.evaluate(() => {
        const primary = [...document.querySelectorAll<HTMLElement>('main button[data-primary-action="true"]')];
        return {
          browser: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          openDisclosureCount: document.querySelectorAll("main details[open]").length,
          primary: primary.map((element) => {
            const bounds = element.getBoundingClientRect();
            return { label: element.innerText, bounds: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right } };
          }),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(reportState.scrollY).toBe(0);
      expect(reportState.primary.length).toBeLessThanOrEqual(1);
      expect(reportState.horizontalOverflow).toBe(false);
      const reportCapture = {
        fixture: scenario.name,
        view: "Operational Report panel · viewport-only scrollY=0",
        detailSource: "existing producer-shaped mocked detail route; proxyLifecycleDetail('SETTLED') with explicit evidence override",
        runtime: "LIVE read-model fixture label only; no live provider calls",
        font: "DejaVu Sans forced for audit geometry",
        ...reportState,
        navigationMutationCount: writes.length,
      };
      captures.push(reportCapture);
      console.log("F7_REPORT_CAPTURE", JSON.stringify(reportCapture));
      await page.screenshot({ path: testInfo.outputPath(`f7-${scenario.name}-${viewport.label}-report-scroll0.png`), fullPage: false });
      await page.screenshot({ path: testInfo.outputPath(`f7-${scenario.name}-${viewport.label}-report-full.png`), fullPage: true });
      expect(writes).toEqual([]);
      await page.close();
    }
  }
  await testInfo.attach("f7-settled-evidence-browser-manifest.json", {
    body: Buffer.from(JSON.stringify(captures, null, 2)),
    contentType: "application/json",
  });
});

test("Assessment PAY dispositions and legal actions fit the audited first viewport for genuine source identities", async ({ browser }, testInfo) => {
  const viewports = [
    { width: 1173, height: 751, label: "desktop-1173x751" },
    { width: 390, height: 844, label: "mobile-390x844" },
  ] as const;
  const viewportViolations: Array<Record<string, unknown>> = [];
  const viewportMeasurements: Array<Record<string, unknown>> = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const fixture = await actualSourcePayFixtures(page);
    const unexpectedWrites = await openFixture(
      page,
      fixture.payDetailById["OBL-J0C-001"],
      fixture.queue,
      fixture.payDetailById,
      fixture.selectedCandidateId,
    );
    // Match the Lenovo audit's observed fallback font rather than relying on
    // the writer host's default font metrics when checking first-view bounds.
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });

    for (const scenario of [
      { selectedId: "OBL-J0C-001", businessName: "business license and flexi desk", action: "Prepare Arc Testnet settlement proxy" },
      { selectedId: "OBL-J0C-003", businessName: "cloud infrastructure subscription", action: "Prepare Arc Testnet settlement proxy" },
    ] as const) {
      if (viewport.label.startsWith("mobile")) {
        await openMobileQueue(page);
      }
      await queueItem(page, scenario.selectedId).click();
      await expect(queueItem(page, scenario.selectedId)).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("region", { name: "Selected source obligation" }).locator("h2")).toContainText(scenario.businessName);
      await expandLifecycleStages(page);
      await page.getByRole("navigation", { name: "Payment lifecycle navigation" })
        .getByRole("button", { name: "Assessment", exact: true }).click();
      await collapseLifecycleStages(page);

      const detailResponse = fixture.payDetailById[scenario.selectedId];
      const card = page.getByRole("region", { name: "Assessment result" });
      const selectedSource = page.getByRole("region", { name: "Selected source obligation" });
      const payResult = card.getByText("Advisory — PAY", { exact: true });
      const reason = card.getByText("The current assessment found no validated payment blocker; separate payment controls still apply.", { exact: true });
      const eligibility = page.getByTestId("payment-eligibility");
      const action = card.getByRole("button", { name: scenario.action, exact: true });
      const identity = selectedSource.locator("h2");
      const stage = page.getByText("Step 2 of 6 · Assessment", { exact: true });
      const currentStage = page.getByText("Current stage", { exact: true });
      const viewportScrollY = await page.evaluate(() => window.scrollY);
      expect(viewportScrollY, `${scenario.selectedId} ${viewport.label} should remain at the top after navigation`).toBe(0);
      await expect(selectedSource).toBeVisible();
      await expect(stage).toBeVisible();
      await expect(currentStage).toBeVisible();
      await expect(payResult).toBeVisible();
      await expect(reason).toBeVisible();
      await expect(eligibility).toBeVisible();
      await expect(action).toBeVisible();
      await expect(card.locator("details[open]")).toHaveCount(0);
      await expect(page.getByRole("main").locator("details[open]")).toHaveCount(0);

      await expect(eligibility).toContainText("PAY is advisory for the selected obligation");
      if (scenario.selectedId === "OBL-J0C-001") {
        await expect(eligibility).toContainText(/current payment-route assurance is not ready/i);
      }
      await expect(card).not.toContainText("Not the selected payment candidate.");
      await expect(card).not.toContainText("View selected payment candidate");
      await expect(card).not.toContainText("OBL-J0C-001");
      await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
      const measurements = await Promise.all([identity, stage, currentStage, payResult, reason, eligibility, action].map(async (locator) => ({
        label: await locator.innerText(),
        ...await locator.evaluate((element) => {
          const { top, bottom, left, right } = element.getBoundingClientRect();
          return { top, bottom, left, right };
        }),
      })));
      viewportMeasurements.push({
        obligationId: scenario.selectedId,
        viewport: viewport.label,
        viewportSize: { width: viewport.width, height: viewport.height },
        scrollY: viewportScrollY,
        disclosureOpen: await page.getByRole("main").locator("details[open]").count() > 0,
        measurements,
      });
      console.log("ASSESSMENT_FIRST_VIEWPORT", JSON.stringify(viewportMeasurements.at(-1)));
      const outOfViewport = measurements.filter((box) => box.top < 0 || box.bottom > viewport.height || box.left < 0 || box.right > viewport.width);
      await page.screenshot({
        path: testInfo.outputPath(`assessment-first-viewport-${scenario.selectedId}-${viewport.label}.png`),
        fullPage: false,
      });
      if (outOfViewport.length > 0) {
        viewportViolations.push({ scenario, viewport, scrollY: viewportScrollY, measurements: outOfViewport });
      }
      expect(unexpectedWrites).toEqual([]);
    }
    await page.close();
  }
  await testInfo.attach("assessment-first-viewport-bounds.json", {
    body: Buffer.from(JSON.stringify(viewportMeasurements, null, 2)),
    contentType: "application/json",
  });
  expect(viewportViolations, JSON.stringify(viewportViolations, null, 2)).toEqual([]);
});

test("manual obligation selection stays bound when multiple queue rows show PAY advisories", async ({ browser }, testInfo) => {
  const candidateDetail = liveWinnerForPreparation();
  candidateDetail.current_assessment.provider_mode = "NOT_LIVE_AI";
  candidateDetail.current_assessment.provider_used = "deterministic-test-fixture";
  const nonWinnerDetail = detailFor("OBL-UAT-02", "40.00", "2026-10-10", "UAT-INV-02");
  const queue = [
    { ...obligation, assessed: true, decision: "PAY", provider_mode: "NOT_LIVE_AI" },
    { ...secondObligation, assessed: true, decision: "PAY", provider_mode: "NOT_LIVE_AI" },
    { ...proxiedObligation, assessed: true, decision: "HOLD", provider_mode: "NOT_LIVE_AI" },
  ];

  for (const viewport of [{ width: 1280, height: 1000, label: "desktop" }, { width: 390, height: 844, label: "mobile" }]) {
    const page = await browser.newPage({ viewport });
    const unexpectedWrites = await openFixture(page, candidateDetail, queue, {
      "OBL-UAT-01": candidateDetail,
      "OBL-UAT-02": nonWinnerDetail,
    });
    if (viewport.label === "mobile") await openMobileQueue(page);
    await queueItem(page, "OBL-UAT-02").click();
    await expect(queueItem(page, "OBL-UAT-02")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("region", { name: "Selected source obligation" }).locator("h2")).toContainText("software services");
    await expandLifecycleStages(page);
    const assessmentStage = page.getByRole("button", { name: "Assessment", exact: true });
    await expect(assessmentStage).toHaveAttribute("data-stage-state", "CURRENT");
    await assessmentStage.click();
    await collapseLifecycleStages(page);

    const card = page.getByRole("region", { name: "Assessment result" });
    await expect(card).toContainText("Advisory — PAY");
    await expect(card.getByTestId("payment-eligibility")).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected source obligation" }).locator("h2")).toContainText("software services");
    await expect(card).not.toContainText("OBL-UAT-01");
    await expect(card.getByRole("button", { name: "View selected payment candidate" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Continue to Authorization" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Approver decision packet" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Payment status" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Reconciliation receipt" })).toHaveCount(0);
    const openedDetails = await page.getByRole("main").locator("details[open]").allTextContents();
    expect(openedDetails.filter((text) => !text.includes("View all stages"))).toEqual([]);
    for (const row of await page.locator('button[data-obligation-id]').all()) {
      await expect(row).not.toContainText(/Sole PAY candidate|route assurance|PAE|execution|provider/i);
    }
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    const primaryAction = page.locator('main button[data-primary-action="true"]');
    if (await primaryAction.count()) expect(await primaryAction.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    await page.screenshot({ path: testInfo.outputPath(`manual-selection-pay-assessment-${viewport.label}.png`), fullPage: true });
    await expect(queueItem(page, "OBL-UAT-02")).toHaveAttribute("aria-current", "true");
    expect(unexpectedWrites).toEqual([]);
    await page.close();
  }
});

test("fresh PAY after proxy preparation does not show stale PAE recovery on desktop or mobile", async ({ browser }, testInfo) => {
  const freshPay = postProxyFreshPayWithAggregateRevoked();

  for (const viewport of [{ width: 1173, height: 751, label: "desktop-1173x751" }, { width: 390, height: 844, label: "mobile-390x844" }]) {
    const page = await browser.newPage({ viewport });
    const unexpectedWrites = await openFixture(page, freshPay);
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
    await expect(page.getByTestId("current-next-step")).toContainText("A current PAY advisory assessment is already recorded. View Assessment to review it.");
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-screen-1-${viewport.label}.png`), fullPage: true });
    await page.getByRole("button", { name: "View Assessment" }).click();
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("Advisory — PAY");
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    const assessmentCard = page.getByRole("region", { name: "Assessment result" });
    const review = assessmentCard.getByRole("button", { name: "Review current PAY assessment" });
    await expect(review).toBeVisible();
    await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("What to do next");
    await expect(page.getByText(`Step 2 of 6 · Assessment`, { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const currentPosition = page.getByText("Current stage", { exact: true });
    const sourceIdentity = page.getByRole("region", { name: "Selected source obligation" }).locator("h2");
    const payResult = assessmentCard.getByText("Advisory — PAY", { exact: true });
    const assessmentReason = assessmentCard.getByText(freshPay.current_assessment.race.result.decision_summary, { exact: true });
    const measured = await Promise.all([sourceIdentity, page.getByText("Step 2 of 6 · Assessment", { exact: true }), currentPosition, payResult, assessmentReason, review].map(async (locator) => ({
      label: await locator.innerText(),
      ...await locator.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY: window.scrollY })),
    })));
    const reviewBounds = measured.at(-1)!;
    console.log("FRESH_PAY_REVIEW_FIRST_VIEWPORT", JSON.stringify({
      viewport,
      measured,
      primaryActionCount: await page.locator('main button[data-primary-action="true"]').count(),
      mutationCount: unexpectedWrites.length,
    }));
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-assessment-first-view-${viewport.label}.png`), fullPage: false });
    expect(measured.every((item) => item.scrollY === 0 && item.top >= 0 && item.bottom <= viewport.height), JSON.stringify({ viewport, measured })).toBe(true);
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-screen-2-before-review-${viewport.label}.png`), fullPage: true });
    await page.getByRole("region", { name: "Assessment result" }).getByRole("button", { name: "Review current PAY assessment" }).click();
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue to Authorization" })).toBeVisible();
    await page.getByRole("button", { name: "Continue to Authorization" }).click();
    await expect(page.getByRole("region", { name: "Approver decision packet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Authorize payment" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    expect(unexpectedWrites).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-authorization-${viewport.label}.png`), fullPage: true });
    await page.close();
  }
});

test("Command Center desktop accessibility and review image", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  const unexpectedWrites = await openFixture(page);
  await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
  await expect(queueItem(page, "OBL-UAT-01")).toContainText("PAY recommendation (advisory)");
  await expect(page.getByRole("button", { name: "View all stages", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" })).toHaveCount(0);
  await expect(page.getByText("No payment intent created")).toBeHidden();
  const developerEvidence = page.getByText("Developer & audit evidence");
  await expect(developerEvidence.locator("xpath=..")).not.toHaveAttribute("open");
  await expect(page.getByText("Source and current payment records")).toBeHidden();
  await developerEvidence.focus();
  await page.keyboard.press("Enter");
  await expect(developerEvidence.locator("xpath=..")).toHaveAttribute("open", "");
  await expect(developerEvidence.locator("xpath=..").locator("details[open]")).toHaveCount(0);
  const sourceEvidence = page.getByText("Source and current payment records");
  await expect(sourceEvidence.locator("xpath=..")).not.toHaveAttribute("open");
  await sourceEvidence.click();
  await expect(page.getByText("Source amount").last()).toBeVisible();
  await sourceEvidence.click();
  await developerEvidence.click();
  await expect(page.getByText("Arc Testnet settlement proxy", { exact: true })).toHaveCount(0);
  await expandLifecycleStages(page);
  const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
  await expect(lifecycle.locator("li button > span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await expect(lifecycle).toContainText("Approval locked — route assurance not ready");
  await expect(lifecycle.locator('[aria-current="step"]')).toContainText("Assessment");
  await expect(page.getByTestId("current-next-step")).toContainText("Current position: Assessment");
  await expect(page.getByTestId("current-next-step")).toContainText("A current PAY advisory assessment is already recorded. View Assessment to review it.");
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment" }).click();
  await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("no review evidence in this detail; authorization remains locked");
  await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(0);
  await page.getByText("Demo tools", { exact: true }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  const beforePlayback = unexpectedWrites.length;
  await page.getByRole("button", { name: "Show sample playback" }).click();
  const playback = page.getByRole("region", { name: "Read-only sample playback" });
  await expect(playback).toContainText("No approval, assurance, provider call, or settlement is performed");
  await expect(playback.getByRole("region", { name: "Illustrative same-intent branches" })).toContainText("Changed destination branch — expected BLOCK");
  expect(unexpectedWrites.slice(beforePlayback)).toEqual([]);
  await page.getByRole("button", { name: "Hide sample playback" }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  await page.getByText("Demo tools", { exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Authorization" })).toBeDisabled();
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
  const sourceProxy = page.getByRole("region", { name: "Selected source obligation" });
  await expect(sourceProxy).not.toContainText("OBL-UAT-01");
  await expect(sourceProxy).toContainText("125.00 USD");
  await expect(sourceProxy).toContainText("OUTSTANDING");
  await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(0);
  await queueItem(page, "OBL-UAT-02").click();
  await expect(page.getByRole("heading", { name: "software services" })).toBeVisible();
  await expect(sourceProxy).not.toContainText("OBL-UAT-02");
  await expect(sourceProxy).toContainText("40.00 USD");
  await expect(sourceProxy).toContainText("OUTSTANDING");
  await expect(sourceProxy).not.toContainText("OBL-UAT-01");
  await expect(page.getByText("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.")).toBeHidden();
  await expect(lifecycle).toContainText("Approval locked — route assurance not ready");
  await queueItem(page, "OBL-UAT-03").click();
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("125.00 USD");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).not.toContainText("125.000000 USDC");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).not.toContainText("ARC_TESTNET");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
  await queueItem(page, "OBL-UAT-02").click();
  const stageBoxes = await lifecycle.getByRole("listitem").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(stageBoxes[0]).toBeLessThan(stageBoxes[1]);
  expect(await page.locator(".tabular").first().evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
  const nav = page.getByRole("navigation", { name: "Payment lifecycle navigation" });
  await nav.getByRole("button", { name: "Assessment" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Assessment" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toContain("Assessment");
  await nav.getByRole("list", { name: "Payment lifecycle" }).getByRole("button", { name: "Obligation" }).focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await collapseLifecycleStages(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  const desktopZoom = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    htmlRect: document.documentElement.getBoundingClientRect().toJSON(),
    bodyRect: document.body.getBoundingClientRect().toJSON(),
    internalOverflows: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ tag: element.tagName, id: (element as HTMLElement).id, cls: (element as HTMLElement).className.toString().slice(0, 100), text: (element.textContent ?? "").trim().slice(0, 45), client: (element as HTMLElement).clientWidth, scroll: (element as HTMLElement).scrollWidth }))
      .filter((element) => element.scroll > element.client + 1)
      .sort((a, b) => (b.scroll - b.client) - (a.scroll - a.client))
      .slice(0, 8),
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 80), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
      .filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }));
  expect(desktopZoom.width, JSON.stringify(desktopZoom)).toBeLessThanOrEqual(desktopZoom.viewport);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.mouse.move(1, 1);
  await expect(page).toHaveScreenshot("command-center-desktop.png", { fullPage: true, animations: "disabled" });
  expect(unexpectedWrites).toEqual([]);
});

test("post-approval N+1 response states remain blocked without assessment actions", async ({ page }, testInfo: TestInfo) => {
  for (const scenario of [
    { paeSealed: false, expectedStage: "Assurance", expectedGuidance: "Authorization recorded · Assurance failed/blocked" },
    { paeSealed: true, expectedStage: "Assurance", expectedGuidance: "Current payment authority is not available for submission. Re-establish the current assessment and authorization path before any new execution packet." },
  ]) {
    const queue = [{ ...obligation, assessed: false, decision: null, provider_mode: null }];
    const writes = await openFixture(page, postApprovalNPlusOneDetail(scenario.paeSealed), queue);
    await expandLifecycleStages(page);
    await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assurance" }).click();
    const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
    await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
    await expect(lifecycle.locator('[aria-current="step"]')).toContainText(scenario.expectedStage);
    await expect(lifecycle.getByRole("button", { name: "Assurance" })).toHaveAttribute("data-stage-state", scenario.paeSealed ? "CURRENT" : "BLOCKED");
    await expect(lifecycle.getByRole("button", { name: "Payment" })).toHaveAttribute("data-stage-state", "UPCOMING");
    await collapseLifecycleStages(page);
    const assurance = page.getByRole("region", { name: "Deterministic assurance result" });
    await expect(assurance).toContainText(scenario.expectedGuidance);
    if (scenario.paeSealed) {
      await page.screenshot({ path: testInfo.outputPath("sealed-no-current-packet.png") });
    }
    await expect(page.getByRole("button", { name: "Run AI Assessment" })).toHaveCount(0);
    await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
    await expandLifecycleStages(page);
    await expect(page.getByRole("button", { name: "Payment" })).toBeDisabled();
    expect(writes).toEqual([]);
    await page.unrouteAll();
  }
});

test("an already assessed obligation offers read-only View Assessment in the first viewport", async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1188, height: 761 });
  const writes = await openFixture(page, liveWinnerForPreparation());
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
  await expect(page.getByTestId("current-next-step")).toContainText("A current PAY advisory assessment is already recorded. View Assessment to review it.");
  await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View all stages" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Approver decision packet" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Payment status" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Reconciliation receipt" })).toHaveCount(0);
  const firstViewport = await page.evaluate(() => {
    const step = document.querySelector('[data-testid="current-next-step"]');
    const reason = step?.querySelector("p:nth-of-type(2)") ?? null;
    const elements = [
      { name: "selected source identity", element: document.querySelector('[aria-label="Selected source obligation"] h2') },
      { name: "viewed and current position", element: document.querySelector('[aria-label="Guided lifecycle"] p:nth-of-type(2)') },
      { name: "current reason", element: reason },
      { name: "permitted-action guidance", element: step?.querySelector('button[data-primary-action="true"]') ?? null },
      { name: "permitted primary action", element: step?.querySelector('button[data-primary-action="true"]') ?? null },
    ];
    return elements.map(({ name, element }) => {
      const rect = element?.getBoundingClientRect();
      return { name, exists: Boolean(element), top: rect?.top ?? null, bottom: rect?.bottom ?? null };
    });
  });
  const primaryHeight = await page.locator('[data-testid="current-next-step"] button[data-primary-action="true"]').evaluate((element) => element.getBoundingClientRect().height);
  expect(primaryHeight).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("desktop-short-assessment-resume.png") });
  expect(firstViewport.every((element) => element.exists && element.top! >= 0 && element.bottom! <= 761), JSON.stringify(firstViewport)).toBe(true);
  await page.getByRole("button", { name: "View Assessment" }).click();
  await expect(page.getByRole("region", { name: "Assessment result" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("sealed, submitted, unknown and reconciled proxy states preserve source truth", async ({ page }) => {
  const scenarios = [
    { state: "AUTHORIZED" as const, lifecycle: "ASSURANCE PASSED · 10/10 controls passed for the current binding.", position: "Assurance", ariaLabel: "Current stage: Assurance. Step 4 of 6.", action: "Continue to Payment" },
    { state: "SUBMITTED" as const, lifecycle: "Submission is recorded. Provider outcome is awaiting reconciliation", position: "Reconciliation", ariaLabel: "Current stage: Reconciliation. Step 6 of 6.", action: "Reconcile this same intent" },
    { state: "UNKNOWN" as const, lifecycle: "Outcome unknown · read-only reconciliation only; do not resubmit", position: "Reconciliation", ariaLabel: "Current stage: Reconciliation. Step 6 of 6.", action: "Reconcile this same intent" },
    { state: "SETTLED" as const, lifecycle: "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION", position: "Reconciliation", ariaLabel: "Current stage: Reconciliation. Step 6 of 6.", action: null },
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: 1280, height: 1500 });
    const writes = await openFixture(page, proxyLifecycleDetail(scenario.state));
    await expandLifecycleStages(page);
    await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: scenario.position }).click();
    await collapseLifecycleStages(page);
    const summary = page.getByRole("region", { name: "Selected source obligation" });
    await expect(summary).toContainText("125.00 USD");
    await expect(summary).toContainText("OUTSTANDING");
    await expect(summary).not.toContainText("controlled settlement proxy");
    await expect(summary).not.toContainText("ARC_TESTNET");
    const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
    const currentStageCard = scenario.position === "Assurance"
      ? page.getByRole("region", { name: "Deterministic assurance result" })
      : page.getByRole("region", { name: "Reconciliation receipt" });
    await expect(currentStageCard).toContainText(scenario.lifecycle);
    await expect(page.getByRole("heading", { name: scenario.ariaLabel })).toHaveCount(1);
    await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(scenario.action ? 1 : 0);
    if (scenario.action) {
      await expect(currentStageCard.getByRole("button", { name: scenario.action })).toBeVisible();
    } else {
      await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
    }
    if (scenario.state !== "AUTHORIZED") {
      await expect(page.getByRole("button", { name: /^Continue to / })).toHaveCount(0);
    }
    if (scenario.state === "AUTHORIZED") {
      await expandLifecycleStages(page);
      await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Payment" })).toHaveAttribute("data-stage-state", "AVAILABLE");
      await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assurance" }).click();
      await expect(page.getByRole("region", { name: "Deterministic assurance result" }).getByRole("button", { name: "Continue to Payment" })).toBeVisible();
    }
    await expect(page.getByText(/real-world payable settled/i)).toHaveCount(0);
    expect(writes).toEqual([]);
  }
});

test("stale detail offers only a mocked read refresh after an assessment response", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests: string[] = [];
  let detailReads = 0;
  const unassessed: Record<string, any> = structuredClone(detail);
  unassessed.current_assessment = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/obligations" && method === "GET") {
      return route.fulfill({ json: { obligations: [{ ...obligation, assessed: false, decision: null }], assessed_count: 0, total_count: 1 } });
    }
    if (url.pathname === "/api/obligations/OBL-UAT-01" && method === "GET") {
      detailReads += 1;
      return detailReads === 1 ? route.fulfill({ json: unassessed }) : route.fulfill({ status: 503, json: { error: "Mocked current detail unavailable" } });
    }
    if (url.pathname === "/api/obligations/OBL-UAT-01/assess" && method === "POST") {
      return route.fulfill({ json: { error: "Mocked assessment is unavailable" }, status: 503 });
    }
    return route.fulfill({ status: 404, json: { error: "This fixture does not permit other actions." } });
  });
  await page.goto("/");
  await queueItem(page, "OBL-UAT-01").click();
  await expect(page.getByTestId("current-next-step").getByRole("heading")).not.toHaveText("Loading");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Run AI Assessment" }).click();
  await expect(page.getByTestId("current-next-step")).toContainText("Last-known state — stale");
  await expect(page.getByRole("button", { name: "Refresh current status" })).toBeVisible();
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
  expect(requests.filter((request) => /\/approve$|\/execute$|preflight|provider/i.test(request))).toEqual([]);
  expect(requests.filter((request) => request.startsWith("POST"))).toEqual(["POST /api/obligations/OBL-UAT-01/assess"]);
});

test("Command Center mobile layout and review image", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unexpectedWrites = await openFixture(page, liveWinnerForPreparation());
  await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
  await expect(mobileQueueToggle(page)).toBeVisible();
  const assertMobileTarget = async (locator: ReturnType<typeof page.getByRole> | ReturnType<typeof page.locator>, label: string) => {
    expect(await locator.evaluate((element) => element.getBoundingClientRect().height), `${label} mobile target`).toBeGreaterThanOrEqual(44);
  };
  await assertMobileTarget(mobileQueueToggle(page), "Obligation queue toggle");
  await expect(queueItem(page, "OBL-UAT-01")).toBeHidden();
  await openMobileQueue(page);
  await expect(queueItem(page, "OBL-UAT-01")).toBeVisible();
  await assertMobileTarget(queueItem(page, "OBL-UAT-01"), "Queue obligation");
  await page.getByRole("button", { name: "Close obligation list" }).click();
  const mobilePrimary = page.locator('[data-testid="current-next-step"] button[data-primary-action="true"]');
  await expect(mobilePrimary).toBeVisible();
  expect(await mobilePrimary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("No payment intent created")).toBeHidden();
  await expect(page.getByText("Arc Testnet settlement proxy", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Step 1 of 6 · Obligation")).toBeVisible();
  await expect(page.getByText("Step 1 of 6 · Obligation")).toHaveAttribute("aria-live", "polite");
  await assertMobileTarget(page.getByRole("button", { name: "View all stages" }), "View all stages");
  const mobileBack = page.getByRole("button", { name: "Back" });
  await expect(mobileBack).toBeVisible();
  expect(await mobileBack.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "View all stages", exact: true }).click();
  const lifecycle = page.getByRole("navigation", { name: "Payment lifecycle navigation" });
  await expect(lifecycle.locator("li button > span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await page.getByText("Demo tools", { exact: true }).click();
  await assertMobileTarget(page.locator("summary").filter({ hasText: "Demo tools" }), "Demo tools");
  await page.getByText("Read-only sample", { exact: true }).click();
  await assertMobileTarget(page.locator("summary").filter({ hasText: "Read-only sample" }), "Read-only sample");
  await page.getByText("Additional tools", { exact: true }).click();
  await assertMobileTarget(page.getByRole("button", { name: "Operational Report (secondary)" }), "Operational Report");
  const beforePlayback = unexpectedWrites.length;
  await page.getByRole("button", { name: "Show sample playback" }).click();
  await assertMobileTarget(page.getByRole("button", { name: "Hide sample playback" }), "Sample playback");
  await assertMobileTarget(page.locator("summary").filter({ hasText: "Evidence & technical details" }), "Sample evidence disclosure");
  const playback = page.getByRole("region", { name: "Read-only sample playback" });
  await expect(playback).toContainText("No approval, assurance, provider call, or settlement is performed");
  await expect(playback.getByRole("region", { name: "Illustrative same-intent branches" })).toContainText("Changed destination branch — expected BLOCK");
  expect(unexpectedWrites.slice(beforePlayback)).toEqual([]);
  await page.getByRole("button", { name: "Hide sample playback" }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  await page.getByText("Demo tools", { exact: true }).click();
  await page.getByText("Additional tools", { exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Authorization" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("125.00 USD");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
  await page.getByRole("button", { name: "View all stages", exact: true }).click();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  const zoomedDimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 70), right: Math.round(element.getBoundingClientRect().right) }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }));
  expect(zoomedDimensions.documentWidth, JSON.stringify(zoomedDimensions)).toBeLessThanOrEqual(zoomedDimensions.viewportWidth);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.mouse.move(1, 1);
  await expect(page).toHaveScreenshot("command-center-mobile.png", { fullPage: true, animations: "disabled" });
  expect(unexpectedWrites).toEqual([]);
});

test("Assurance Continue is a 44px read-only navigation control in the first viewport", async ({ browser }, testInfo) => {
  const viewports = [
    { width: 1173, height: 751, label: "desktop-1173x751" },
    { width: 390, height: 844, label: "mobile-390x844" },
  ] as const;
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const writes = await openFixture(page, proxyLifecycleDetail("AUTHORIZED"));
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await expect(page.getByText("Step 1 of 6 · Obligation")).toBeVisible();
    await expandLifecycleStages(page);
    await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assurance" }).click();
    await collapseLifecycleStages(page);
    await expect(page.getByText("Step 4 of 6 · Assurance")).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Continue to Payment" }).last();
    await expect(continueButton).toBeVisible();
    expect(await continueButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const continueBounds = await continueButton.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY: window.scrollY }));
    const selectedIdentity = page.getByRole("region", { name: "Selected source obligation" }).locator("h2");
    await expect(selectedIdentity).toBeVisible();
    await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toContainText("ASSURANCE PASSED");
    console.log("ASSURANCE_CONTINUE_FIRST_VIEWPORT", JSON.stringify({ viewport, continueBounds }));
    await page.screenshot({ path: testInfo.outputPath(`assurance-continue-first-viewport-${viewport.label}.png`), fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(continueBounds.bottom).toBeLessThanOrEqual(viewport.height);
    const before = writes.length;
    await continueButton.click();
    await expect(page.getByText("Step 5 of 6 · Payment")).toBeVisible();
    expect(writes.slice(before)).toEqual([]);
    expect(page.getByRole("button", { name: "Execute Test Payment" })).toHaveCount(0);
    await page.close();
  }
});

test("blocked Assurance and historical Assessment keep truthful no-action guidance in the mobile first viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const queue = [{ ...obligation, assessed: false, decision: null, provider_mode: null }];
  const writes = await openFixture(page, postApprovalNPlusOneDetail(false), queue);
  await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });

  await expandLifecycleStages(page);
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assurance", exact: true }).click();
  await collapseLifecycleStages(page);
  const assurance = page.getByRole("region", { name: "Deterministic assurance result" });
  const noAction = assurance.getByTestId("assurance-no-action-guidance");
  await expect(assurance).toContainText("Authorization recorded · Assurance failed/blocked");
  await expect(noAction).toContainText("No further product action is available in this state.");
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Exception recovery" })).toBeVisible();
  const assuranceBounds = await noAction.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY: window.scrollY }));
  console.log("BLOCKED_ASSURANCE_GUIDANCE_FIRST_VIEWPORT", JSON.stringify({
    viewport: { width: 390, height: 844 }, ...assuranceBounds,
    primaryActionCount: await page.locator('main button[data-primary-action="true"]').count(),
    mutationCount: writes.length,
  }));
  await page.screenshot({ path: testInfo.outputPath("blocked-assurance-first-viewport-mobile.png"), fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(assuranceBounds.bottom).toBeLessThanOrEqual(844);

  await expandLifecycleStages(page);
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment", exact: true }).click();
  await collapseLifecycleStages(page);
  const assessmentStatus = page.getByRole("region", { name: "Assessment result" }).getByRole("status");
  await expect(assessmentStatus).toContainText("Authorization is recorded. Assurance failed or is blocked");
  await expect(page.getByRole("button", { name: "Run AI Assessment" })).toHaveCount(0);
  const assessmentBounds = await assessmentStatus.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY: window.scrollY }));
  console.log("HISTORICAL_ASSESSMENT_GUIDANCE_FIRST_VIEWPORT", JSON.stringify({
    viewport: { width: 390, height: 844 }, ...assessmentBounds,
    primaryActionCount: await page.locator('main button[data-primary-action="true"]').count(),
    mutationCount: writes.length,
  }));
  await page.screenshot({ path: testInfo.outputPath("historical-assessment-guidance-first-viewport-mobile.png"), fullPage: false });
  expect(assessmentBounds.scrollY).toBe(0);
  expect(assessmentBounds.bottom).toBeLessThanOrEqual(844);
  const currentRecovery = page.getByTestId("historical-current-recovery-disclosure");
  await expect(currentRecovery).not.toHaveAttribute("open", "");
  await currentRecovery.locator("summary").click();
  await expect(currentRecovery.getByRole("region", { name: "Exception recovery" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("failed 503 detail is presented as Unavailable, never as still Loading", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    requests.push(`${route.request().method()} ${pathname}`);
    if (pathname === "/api/obligations" && route.request().method() === "GET") {
      return route.fulfill({ json: { obligations: [{ ...obligation, assessed: false, decision: null }], assessed_count: 0, total_count: 1 } });
    }
    if (pathname === "/api/obligations/OBL-UAT-01" && route.request().method() === "GET") {
      return route.fulfill({ status: 503, json: { error: "Mocked current detail unavailable" } });
    }
    return route.fulfill({ status: 404, json: { error: "Read-only 503 fixture; no mutation route is available." } });
  });
  await page.goto("/");
  await openMobileQueue(page);
  await expect(page.locator('button[data-obligation-id="OBL-UAT-01"]')).toBeVisible();
  await page.locator('button[data-obligation-id="OBL-UAT-01"]').click();
  await expect(page.getByRole("region", { name: "Selected obligation details" })).toBeVisible();
  await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
  const unavailable = page.getByText("Unavailable", { exact: true }).first();
  await expect(unavailable).toBeVisible();
  await expect(page.getByText("Loading", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source and control details are unavailable; no current action is inferred.")).toBeVisible();
  const primaryActions = page.locator('main button[data-primary-action="true"]');
  const refresh = page.getByRole("button", { name: "Refresh current status", exact: true });
  await expect(refresh).toBeVisible();
  await expect(primaryActions).toHaveCount(1);
  const recoveryDetails = page.getByTestId("unavailable-detail-recovery-disclosure");
  await expect(recoveryDetails).not.toHaveAttribute("open", "");
  const unavailableBounds = await unavailable.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY: window.scrollY }));
  const refreshBounds = await refresh.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
  console.log("UNAVAILABLE_503_FIRST_VIEWPORT", JSON.stringify({
    viewport: { width: 390, height: 844 }, ...unavailableBounds,
    primaryActionCount: await primaryActions.count(),
    actionLabel: "Refresh current status",
    actionBounds: refreshBounds,
    mutationCount: requests.filter((request) => !request.startsWith("GET ")).length,
  }));
  await page.screenshot({ path: testInfo.outputPath("failed-503-unavailable-first-viewport-mobile.png"), fullPage: false });
  expect(unavailableBounds.scrollY).toBe(0);
  expect(refreshBounds.bottom).toBeLessThanOrEqual(844);
  await recoveryDetails.locator("summary").click();
  await expect(recoveryDetails.getByRole("region", { name: "Exception recovery" })).toBeVisible();
  expect(requests.filter((request) => request.startsWith("POST"))).toEqual([]);
});

test("Stage 1 queue states stay truthful with no default selection at desktop and mobile", async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  const oracle = await page.request.get("/api/obligations");
  expect(oracle.ok()).toBe(true);
  const sourceQueue = await oracle.json() as Record<string, any>;
  expect(sourceQueue.obligations).toHaveLength(5);
  expect(sourceQueue.obligations.map((row: Record<string, unknown>) => row.obligation_id)).toContain("OBL-J0C-003");
  const detailOracle = await page.request.get("/api/obligations/OBL-J0C-003");
  expect(detailOracle.ok()).toBe(true);
  const source003Detail = await detailOracle.json() as Record<string, any>;
  expect(source003Detail.record.obligation_id).toBe("OBL-J0C-003");
  const selected003DetailFixture = structuredClone(source003Detail);
  const selected003Assessment = {
    obligation_id: "OBL-J0C-003",
    assessment_id: "TEST-ONLY-OBL-J0C-003-ASSESSMENT",
    assessment_hash: createHash("sha256").update("isolated-stage1-003-assessment-fixture").digest("hex"),
    aggregate_version: String(selected003DetailFixture.aggregate.aggregate_version),
    decision: "PAY",
    reasons: ["Isolated producer-shaped PAY advisory for explicitly selected source obligation 003."],
    provider_used: "Deterministic test fixture",
    provider_mode: "NOT_LIVE_AI",
  };
  selected003DetailFixture.current_assessment = selected003Assessment;
  const selected003QueueFixture = {
    ...sourceQueue,
    obligations: sourceQueue.obligations.map((row: Record<string, any>) => row.obligation_id === "OBL-J0C-003"
      ? { ...row, assessed: true, decision: "PAY", provider_mode: "NOT_LIVE_AI" }
      : row),
  };

  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const captureDir = testInfo.outputPath("stage1-initial-state-captures");
  await mkdir(captureDir, { recursive: true });
  const viewports = [
    { label: "desktop-1173x751", width: 1173, height: 751 },
    { label: "mobile-390x844", width: 390, height: 844 },
  ] as const;
  const states = ["loading", "loaded-none", "true-empty", "error", "selected-003"] as const;
  const manifest: Array<Record<string, unknown>> = [];

  for (const viewport of viewports) {
    for (const stateName of states) {
      const statePage = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const observedRequests: string[] = [];
      let releaseLoading!: () => void;
      const delayedQueue = new Promise<void>((resolve) => { releaseLoading = resolve; });
      await statePage.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        observedRequests.push(`${request.method()} ${url.pathname}`);
        if (url.pathname === "/api/obligations" && request.method() === "GET") {
          if (stateName === "loading") {
            await delayedQueue;
            return route.fulfill({ json: sourceQueue });
          }
          if (stateName === "true-empty") return route.fulfill({ json: { ...sourceQueue, obligations: [] } });
          if (stateName === "error") return route.fulfill({ status: 503, json: { error: "Mocked genuine queue unavailable" } });
          return route.fulfill({ json: stateName === "selected-003" ? selected003QueueFixture : sourceQueue });
        }
        if (url.pathname === "/api/obligations/OBL-J0C-003" && request.method() === "GET" && stateName === "selected-003") {
          return route.fulfill({ json: selected003DetailFixture });
        }
        return route.fulfill({ status: 404, json: { error: "Read-only queue-state fixture; no other route is enabled." } });
      });
      await statePage.goto("/");
      await statePage.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
      await statePage.evaluate(() => document.fonts.ready.then(() => true));

      if (stateName === "loading") {
        await expect(statePage.getByRole("main").getByRole("status")).toContainText("Loading genuine obligations");
        await expect(statePage.getByRole("main").getByText(/no genuine obligations|open demo mode|choose one obligation/i)).toHaveCount(0);
        await expect(statePage.getByRole("main").locator('button[data-obligation-id]')).toHaveCount(0);
      } else if (stateName === "loaded-none") {
        await expect(statePage.locator('button[data-obligation-id]')).toHaveCount(5);
        await expect(statePage.locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(0);
        await expect(statePage.getByTestId("current-next-step").locator("h3")).toHaveText("Choose an obligation");
        await expect(statePage.getByTestId("current-next-step")).toContainText("Choose one obligation from the genuine queue");
        await expect(statePage.getByRole("main")).not.toContainText(/no genuine obligations to show|open demo mode|loading genuine obligations/i);
      } else if (stateName === "true-empty") {
        await expect(statePage.getByTestId("current-next-step").locator("h3")).toHaveText("No genuine obligations");
        await expect(statePage.getByTestId("current-next-step")).toContainText("Refresh the genuine queue to check again");
        await expect(statePage.getByRole("main")).not.toContainText(/open demo mode|loading genuine obligations/i);
      } else if (stateName === "error") {
        await expect(statePage.getByTestId("current-next-step").locator("h3")).toHaveText("Genuine obligations unavailable");
        await expect(statePage.getByTestId("current-next-step")).toContainText("Retry the queue before selecting");
        if (viewport.width >= 768) {
          await expect(statePage.getByRole("main").getByRole("alert")).toContainText("Genuine obligations are unavailable");
          await expect(statePage.getByRole("button", { name: "Retry genuine obligations" })).toBeVisible();
        } else {
          await expect(statePage.getByRole("button", { name: "Open queue to retry" })).toBeVisible();
        }
        await expect(statePage.getByRole("main")).not.toContainText(/no genuine obligations to show|open demo mode|loading genuine obligations/i);
      } else {
        if (viewport.width < 768) await statePage.getByRole("complementary").getByRole("button", { name: "Choose an obligation", exact: true }).click();
        await statePage.locator('button[data-obligation-id="OBL-J0C-003"]').click();
        await expect(statePage.locator('button[data-obligation-id="OBL-J0C-003"]')).toHaveAttribute("aria-current", "true");
        await expect(statePage.locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(1);
        await expect(statePage.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
        const selectedGuidance = statePage.getByTestId("current-next-step");
        await expect(selectedGuidance).not.toContainText(/001|Selected payment candidate/);
        await expect(selectedGuidance).toContainText("A current PAY advisory assessment");
      }

      await statePage.evaluate(() => window.scrollTo(0, 0));
      const measurement = await statePage.evaluate(() => {
        const primary = Array.from(document.querySelectorAll<HTMLButtonElement>('main button[data-primary-action="true"]'));
        const rect = (element?: Element) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
        };
        const stageToggle = document.querySelector<HTMLButtonElement>('button[aria-controls="all-payment-stages"]');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          primaryActionCount: primary.filter((button) => !button.disabled).length,
          primaryActions: primary.map((button) => ({ label: button.innerText.trim(), disabled: button.disabled, bounds: rect(button) })),
          rowCount: document.querySelectorAll('button[data-obligation-id]').length,
          selectedIds: Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-obligation-id][aria-current="true"]')).map((row) => row.dataset.obligationId),
          openDetails: document.querySelectorAll('main details[open]').length,
          navigatorExpanded: stageToggle?.getAttribute("aria-expanded") ?? null,
          documentWidth: document.documentElement.scrollWidth,
          fontFamily: getComputedStyle(document.body).fontFamily,
          userAgent: navigator.userAgent,
          queueHeading: document.querySelector('[data-testid="current-next-step"] h3')?.textContent ?? null,
          stageAnnouncement: document.querySelector('[data-testid="current-next-step"] h3')?.getAttribute("aria-label") ?? null,
          providerMode: null,
        };
      });
      expect(measurement.scrollY).toBe(0);
      expect(measurement.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(measurement.openDetails).toBe(0);
      expect(measurement.navigatorExpanded).not.toBe("true");
      expect(observedRequests.filter((request) => !request.startsWith("GET /api/obligations"))).toEqual([]);
      expect(observedRequests.some((request) => request.startsWith("POST "))).toBe(false);

      const filename = `stage1-${stateName}-${viewport.label}.png`;
      const screenshotPath = testInfo.outputPath(`stage1-initial-state-captures/${filename}`);
      const png = await statePage.screenshot({ path: screenshotPath, fullPage: false });
      const mode = stateName === "selected-003" ? "NOT_LIVE_AI (test overlay; not live provider evidence)" : null;
      const record = {
        candidateSha,
        filename,
        sha256: createHash("sha256").update(png).digest("hex"),
        state: stateName,
        viewport: `${viewport.width}x${viewport.height}`,
        scrollY: measurement.scrollY,
        disclosuresOpen: measurement.openDetails,
        navigatorExpanded: measurement.navigatorExpanded,
        sourceProvenance: stateName === "true-empty" || stateName === "error"
          ? "Test-only queue response override; based on real producer queue, no financial calls."
          : stateName === "loading"
            ? "Real local /api/obligations producer response intentionally delayed by mocked transport."
            : stateName === "selected-003"
              ? "Real local source queue/detail GETs replayed through an isolated route; only the current 003 PAY assessment is a producer-shaped NOT_LIVE_AI test overlay, not a provider result."
              : "Real local GET /api/obligations response replayed through an isolated read-only browser route.",
        assessmentProviderMode: mode,
        browser: measurement.userAgent,
        font: measurement.fontFamily,
        queueHeading: measurement.queueHeading,
        stageAnnouncement: measurement.stageAnnouncement,
        rowCount: measurement.rowCount,
        selectedIds: measurement.selectedIds,
        actionCount: measurement.primaryActionCount,
        actions: measurement.primaryActions,
        navigationPostCount: observedRequests.filter((request) => request.startsWith("POST ")).length,
        providerRouteCount: observedRequests.filter((request) => /balance|preflight|provider|circle|execute/i.test(request)).length,
      };
      manifest.push(record);
      await testInfo.attach(filename, { path: screenshotPath, contentType: "image/png" });
      if (stateName === "selected-003") {
        const viewAssessment = statePage.getByRole("button", { name: "View Assessment", exact: true });
        await expect(viewAssessment).toHaveCount(1);
        await viewAssessment.click();
        await expect(statePage.locator('button[data-obligation-id="OBL-J0C-003"]')).toHaveAttribute("aria-current", "true");
        await expect(statePage.getByRole("main")).toContainText("Advisory — PAY");
        expect(observedRequests.filter((request) => request.startsWith("POST "))).toEqual([]);
        await statePage.evaluate(() => window.scrollTo(0, 0));
        const assessmentFilename = `stage1-selected-003-assessment-${viewport.label}.png`;
        const assessmentPath = testInfo.outputPath(`stage1-initial-state-captures/${assessmentFilename}`);
        const assessmentPng = await statePage.screenshot({ path: assessmentPath, fullPage: false });
        manifest.push({
          ...record,
          filename: assessmentFilename,
          sha256: createHash("sha256").update(assessmentPng).digest("hex"),
          state: "selected-003-assessment",
          queueHeading: "Advisory — PAY",
          sourceProvenance: "Actual OBL-J0C-003 source record and local detail GET; isolated NOT_LIVE_AI PAY assessment overlay only.",
          assessmentProviderMode: mode,
          selectedIds: ["OBL-J0C-003"],
          navigationPostCount: 0,
        });
        await testInfo.attach(assessmentFilename, { path: assessmentPath, contentType: "image/png" });
      }
      if (stateName === "loading") {
        releaseLoading();
        await expect(statePage.locator('button[data-obligation-id]')).toHaveCount(5);
      }
      await statePage.close();
    }
  }

  const manifestPath = testInfo.outputPath("stage1-initial-state-captures/manifest.json");
  await writeFile(manifestPath, JSON.stringify({ candidateSha, source: "Local read-only application GET producer data; only empty/error states are overridden", entries: manifest }, null, 2));
  await testInfo.attach("stage1-initial-state-manifest.json", { path: manifestPath, contentType: "application/json" });
  console.log("STAGE1_INITIAL_STATE_CAPTURE_MANIFEST", JSON.stringify(manifest));
});

test("active kill switch takes precedence over a waiting exact-packet gate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const suspended = proxyLifecycleDetail("AUTHORIZED");
  suspended.execution_kill_switched = true;
  const writes = await openFixture(page, suspended);
  await expandLifecycleStages(page);
  await expect(page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Payment", exact: true })).toHaveAttribute("data-stage-state", "BLOCKED");
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Payment" }).click();
  await collapseLifecycleStages(page);
  await expect(page.getByRole("region", { name: "Payment status" })).toContainText("A payment stop is active. No execution is permitted.");
  await expect(page.getByRole("region", { name: "Payment status" })).toContainText("A payment stop is active. No execution is permitted.");
  await expect(page.getByRole("region", { name: "Exception recovery" })).not.toContainText("Current issue:");
  await expect(page.getByRole("region", { name: "Payment status" })).not.toContainText("Prime · exact-packet authorization");
  await expect(page.getByRole("button", { name: "Execute Test Payment" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("revoked release authority overrides retained packet and exact gate on desktop and mobile", async ({ browser }, testInfo) => {
  const revoked = proxyLifecycleDetail("AUTHORIZED");
  revoked.truth.tameion_control_truth.pae_state = "REVOKED";
  revoked.truth.tameion_control_truth.execution_release_authority = "BLOCKED";
  revoked.execution_gate = "PRIME_AUTHORIZED_EXACT_PACKET";
  revoked.execution_kill_switched = false;

  for (const viewport of [{ width: 1280, height: 900, label: "desktop" }, { width: 390, height: 844, label: "mobile" }]) {
    const page = await browser.newPage({ viewport });
    const writes = await openFixture(page, revoked);
    await expandLifecycleStages(page);
    await page.getByRole("button", { name: "Payment", exact: true }).click();
    await collapseLifecycleStages(page);

    const payment = page.getByRole("region", { name: "Payment status" });
    await expect(payment.locator("h3")).toContainText("Payment authority is revoked");
    await expect(payment).not.toContainText("ready for confirmation");
    await expect(page.getByRole("button", { name: "Execute Test Payment" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /Confirm exact testnet intent/ })).toHaveCount(0);
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`screen-5-revoked-${viewport.label}.png`), fullPage: true });
    expect(writes).toEqual([]);
    await page.close();
  }
});

test("UNKNOWN Payment and Reconciliation keep same-intent guidance and action in the first viewport", async ({ browser }, testInfo) => {
  const viewports = [
    { width: 1173, height: 751, label: "desktop-1173x751" },
    { width: 390, height: 844, label: "mobile-390x844" },
  ] as const;
  const results: Array<Record<string, unknown>> = [];
  const violations: Array<Record<string, unknown>> = [];

  for (const viewport of viewports) {
    for (const stage of ["Payment", "Reconciliation"] as const) {
      const page = await browser.newPage({ viewport });
      const writes = await openFixture(page, proxyLifecycleDetail("UNKNOWN"));
      await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
      await expandLifecycleStages(page);
      await page.getByRole("navigation", { name: "Payment lifecycle navigation" })
        .getByRole("button", { name: stage, exact: true }).click();
      await collapseLifecycleStages(page);
      await page.evaluate(() => window.scrollTo(0, 0));

      const region = page.getByRole("region", { name: stage === "Payment" ? "Payment status" : "Reconciliation receipt" });
      const action = page.getByRole("main").locator('button[data-primary-action="true"]');
      const selectedIdentity = page.getByRole("region", { name: "Selected source obligation" }).locator("h2");
      const status = stage === "Payment" ? region.locator("h3") : region.locator("p").first();
      const noRetry = stage === "Payment"
        ? region.getByRole("status")
        : region.locator("p").first();
      const stagePosition = page.getByText(`Step ${stage === "Payment" ? 5 : 6} of 6 · ${stage}`, { exact: true });
      const currentViewedLabel = stage === "Payment"
        ? page.locator('[aria-label="Guided lifecycle"] p:visible').filter({ hasText: "Viewing Payment · current position Reconciliation" })
        : page.locator('[aria-label="Guided lifecycle"] p:visible').filter({ hasText: "Current stage" });

      await expect(region).toBeVisible();
      await expect(stagePosition).toHaveCount(1);
      await expect(currentViewedLabel).toHaveCount(1);
      await expect(status).toContainText("Outcome unknown");
      await expect(noRetry).toContainText(/no blind retry|do not resubmit|no resubmission/i);
      await expect(action).toHaveCount(1);
      await expect(action).toHaveText("Reconcile this same intent");
      expect(await action.first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole("main").locator("details[open]")).toHaveCount(0);

      const measurement = await page.evaluate(() => {
        const find = (selector: string) => document.querySelector(selector);
        const lifecycleParagraphs = document.querySelectorAll('[aria-label="Guided lifecycle"] p');
        const boxes = [
          ["selected obligation identity", find('[aria-label="Selected source obligation"] h2')],
          ["viewed stage and step", lifecycleParagraphs[0] ?? null],
          ["current/viewed context", lifecycleParagraphs[1] ?? null],
          ["UNKNOWN stage status", find('[aria-label="Payment status"] h3') ?? find('[aria-label="Reconciliation receipt"] p')],
          ["no-resubmission guidance", find('[aria-label="Payment status"] [role="status"]') ?? find('[aria-label="Reconciliation receipt"] p')],
          ["reconciliation action", find('main button[data-primary-action="true"]')],
        ] as const;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          documentWidth: document.documentElement.scrollWidth,
          boxes: boxes.map(([name, element]) => {
            const rect = element?.getBoundingClientRect();
            return { name, exists: Boolean(element), top: rect?.top ?? null, bottom: rect?.bottom ?? null, left: rect?.left ?? null, right: rect?.right ?? null };
          }),
          primaryActionCount: document.querySelectorAll('main button[data-primary-action="true"]').length,
          primaryActionHeight: document.querySelector('main button[data-primary-action="true"]')?.getBoundingClientRect().height ?? null,
        };
      });
      const evidence = { ...measurement, navigationPostCount: writes.filter((request) => request.startsWith("POST ")).length };
      results.push({ stage, ...viewport, ...evidence });
      console.log("UNKNOWN_FIRST_VIEWPORT", JSON.stringify({ stage, ...viewport, ...evidence }));
      await page.screenshot({ path: testInfo.outputPath(`unknown-${stage.toLowerCase()}-${viewport.label}.png`), fullPage: false });

      expect(measurement.scrollY, `${stage} ${viewport.label} must be measured at the top`).toBe(0);
      expect(measurement.documentWidth, `${stage} ${viewport.label} must not overflow`).toBeLessThanOrEqual(viewport.width);
      const outOfViewport = measurement.boxes.filter((box) => !box.exists || box.top! < 0 || box.bottom! > viewport.height || box.left! < 0 || box.right! > viewport.width);
      if (outOfViewport.length > 0) violations.push({ stage, viewport, outOfViewport });
      expect(measurement.primaryActionCount).toBe(1);
      expect(writes, `${stage} navigation must not issue mutations`).toEqual([]);
      await page.close();
    }
  }

  await testInfo.attach("unknown-first-viewport-bounds.json", {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: "application/json",
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

test("selected OBL-J0C-003 assessment response feedback is visible on Obligation and Assessment without navigation writes", async ({ browser }, testInfo) => {
  const viewports = [
    { width: 1173, height: 751, label: "desktop-1173x751" },
    { width: 390, height: 844, label: "mobile-390x844" },
  ] as const;
  const outcomes = [
    { name: "503-unavailable", status: 503, body: { code: "ASSESSMENT_UNAVAILABLE", error: "Assessment service unavailable in the controlled fixture." } },
    { name: "202-in-progress", status: 202, body: { status: "IN_PROGRESS", message: "This assessment is reserved. Replays will not submit a second provider request." } },
  ] as const;
  const manifest: Array<Record<string, unknown>> = [];

  for (const viewport of viewports) {
    for (const outcome of outcomes) {
      const page = await browser.newPage({ viewport });
      const source = await actualSourcePayFixtures(page);
      const selectedDetail = structuredClone(source.payDetailById["OBL-J0C-003"]);
      selectedDetail.current_assessment.provider_mode = "NOT_LIVE_AI";
      selectedDetail.current_assessment.provider_used = "deterministic-browser-fixture";
      const staleVersion = String(selectedDetail.aggregate.aggregate_version);
      const responseVersion = Number(staleVersion) + 1;
      selectedDetail.aggregate.aggregate_version = responseVersion;
      selectedDetail.truth.tameion_control_truth.aggregate_version = responseVersion;
      selectedDetail.current_assessment.aggregate_version = staleVersion;
      const queue = source.queue.map((item) => ({ ...item, assessed: true, decision: "PAY", provider_mode: "NOT_LIVE_AI" }));
      const requests: string[] = [];
      const mutations: string[] = [];
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push(`${request.method()} ${url.pathname}`);
        if (request.method() !== "GET") mutations.push(`${request.method()} ${url.pathname}`);
        if (url.pathname === "/api/obligations" && request.method() === "GET") {
          return route.fulfill({ json: { obligations: queue, assessed_count: 5, total_count: 5, sole_pay_candidate_id: "OBL-J0C-001" } });
        }
        if (url.pathname === "/api/obligations/OBL-J0C-003" && request.method() === "GET") return route.fulfill({ json: selectedDetail });
        if (url.pathname === "/api/obligations/OBL-J0C-003/assess" && request.method() === "POST") {
          return route.fulfill({ status: outcome.status, json: outcome.body });
        }
        return route.fulfill({ status: 404, json: { error: "This controlled assessment feedback fixture allows no other route." } });
      });

      await page.goto("/");
      await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
      if (viewport.width <= 768) await openMobileQueue(page);
      await queueItem(page, "OBL-J0C-003").click();
      await expect(page.getByRole("region", { name: "Selected source obligation" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Viewed stage: Obligation.*Current lifecycle position: Assessment/ })).toBeVisible();
      await page.getByRole("button", { name: "Run AI Assessment" }).click();
      const feedback = page.getByRole("status", { name: "Assessment request status" });
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText(outcome.name.startsWith("202") ? "not a current recommendation" : "Assessment result is unavailable");
      await expect(page.getByRole("button", { name: "Run AI Assessment" })).toBeVisible();
      await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
      const viewStages = ["Obligation", "Assessment"] as const;
      for (const stage of viewStages) {
        if (stage === "Assessment") {
          await expandLifecycleStages(page);
          await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment", exact: true }).click();
        }
        await expect(page.getByRole("status", { name: "Assessment request status" })).toBeVisible();
        await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
        const measurement = await page.evaluate(() => {
          const primary = document.querySelector('main button[data-primary-action="true"]');
          const status = document.querySelector('[aria-label="Assessment request status"]');
          const box = (element: Element | null) => {
            const rect = element?.getBoundingClientRect();
            return rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height } : null;
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            scrollY,
            stage: document.querySelector('[aria-label="Guided lifecycle"] [aria-live="polite"]')?.textContent ?? "Screen 1",
            feedback: status?.textContent ?? null,
            feedbackBounds: box(status),
            primaryLabel: primary?.textContent?.trim() ?? null,
            primaryBounds: box(primary),
            primaryCount: document.querySelectorAll('main button[data-primary-action="true"]').length,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        });
        const pngPath = testInfo.outputPath(`assessment-feedback-${outcome.name}-${viewport.label}-${stage.toLowerCase()}.png`);
        const png = await page.screenshot({ path: pngPath, fullPage: true });
        const viewportPngPath = testInfo.outputPath(`assessment-feedback-${outcome.name}-${viewport.label}-${stage.toLowerCase()}-viewport.png`);
        const viewportPng = await page.screenshot({ path: viewportPngPath, fullPage: false });
        const record = {
          candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          outcome: outcome.name,
          viewedStage: stage,
          targetViewport: viewport,
          source: "read-only local DemoState detail GET for source OBL-J0C-003, then controlled browser mock",
          overrides: ["aggregate version incremented to make the existing assessment pointer stale", "all five queue advisory rows marked PAY for this isolated fixture", "assessment provenance set to NOT_LIVE_AI fixture", "assessment POST response mocked; no AI/provider request"],
          providerMode: "NOT_LIVE_AI queue mock; no assessment provider call",
          browserVersion: browser.version(),
          font: "DejaVu Sans browser override",
          ...measurement,
          mutationRequests: mutations,
          navigationPostCount: mutations.filter((entry) => entry.endsWith("/assess") === false).length,
          fullPageImage: { file: pngPath, sha256: createHash("sha256").update(png).digest("hex") },
          viewportImage: { file: viewportPngPath, sha256: createHash("sha256").update(viewportPng).digest("hex") },
        };
        manifest.push(record);
        console.log("ASSESSMENT_FEEDBACK_CAPTURE", JSON.stringify(record));
        await testInfo.attach(`assessment-feedback-${outcome.name}-${viewport.label}-${stage.toLowerCase()}.png`, { path: pngPath, contentType: "image/png" });
        await testInfo.attach(`assessment-feedback-${outcome.name}-${viewport.label}-${stage.toLowerCase()}-viewport.png`, { path: viewportPngPath, contentType: "image/png" });
        expect(measurement.horizontalOverflow).toBe(false);
        expect(measurement.primaryCount).toBe(1);
        if (stage === "Assessment") {
          const queueReadsBefore = requests.filter((entry) => entry === "GET /api/obligations").length;
          const detailReadsBefore = requests.filter((entry) => entry === "GET /api/obligations/OBL-J0C-003").length;
          await feedback.getByRole("button", { name: "Refresh queue summary (read-only)" }).click();
          await expect(feedback).toContainText("read-only queue summary was refreshed");
          expect(requests.filter((entry) => entry === "GET /api/obligations")).toHaveLength(queueReadsBefore + 1);
          expect(requests.filter((entry) => entry === "GET /api/obligations/OBL-J0C-003")).toHaveLength(detailReadsBefore);
          expect(mutations).toEqual([`POST /api/obligations/OBL-J0C-003/assess`]);
        }
      }
      expect(mutations).toEqual([`POST /api/obligations/OBL-J0C-003/assess`]);
      await page.close();
    }
  }

  await testInfo.attach("assessment-feedback-captures.json", {
    body: Buffer.from(JSON.stringify(manifest, null, 2)),
    contentType: "application/json",
  });
});
