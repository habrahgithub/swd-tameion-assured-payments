import AxeBuilder from "@axe-core/playwright";
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
    await expect(page.getByText(/ARC TESTNET|Safety Kernel|PAE|USDC|provider|reconciliation/i)).toHaveCount(0);
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
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  };

  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await assertGenuineFirstView(760);
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
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await assertGenuineFirstView(844, true);
  await page.screenshot({ path: testInfo.outputPath("genuine-mobile-first-view.png") });
  await page.getByRole("button", { name: /Switch obligation/ }).click();
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
  return {
    ...source,
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
    execution_packet: status === "AUTHORIZED" ? { packet_sha256: "e".repeat(64), packet: { obligation_id: "OBL-UAT-01" } } : null,
    sealed_pae_instruction_hash: "d".repeat(64),
    execution: executionStatus ? { status: executionStatus, provider_ref: "MOCK-ARC-REFERENCE" } : null,
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
) {
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") unexpectedWrites.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/obligations") return route.fulfill({ json: {
      obligations: queue,
      assessed_count: queue.filter((item) => item.assessed).length,
      total_count: queue.length,
      sole_pay_candidate_id: queue.length === 3 ? "OBL-UAT-01" : null,
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
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return unexpectedWrites;
}

test("clerk Assessment result renders on desktop and mobile from a read-only producer-shaped detail", async ({ page }, testInfo) => {
  const result = liveWinnerForPreparation();
  result.current_assessment.provider_mode = "NOT_LIVE_AI";
  result.current_assessment.provider_used = "test-fixture-provider";
  const unexpectedWrites = await openFixture(page, result);

  const openAssessmentOnDesktop = async () => {
    await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assessment" }).click();
    const card = page.getByRole("region", { name: "Assessment result" });
    await expect(card.getByRole("heading", { name: "Current stage: Assessment. Step 2 of 6." })).toBeVisible();
    await expect(card.getByTestId("assessment-provenance")).toContainText("deterministic fallback, not live AI");
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
  const desktopRerun = desktopCard.getByRole("button", { name: "Run AI Assessment again" });
  await expect(desktopRerun).toBeVisible();
  expect(await desktopRerun.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("clerk-assessment-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.getByText("View all stages").click();
  await page.getByRole("navigation", { name: "All lifecycle stages" }).getByRole("button", { name: "Assessment" }).click();
  const mobileCard = page.getByRole("region", { name: "Assessment result" });
  await expect(mobileCard.getByRole("heading", { name: "Current stage: Assessment. Step 2 of 6." })).toBeVisible();
  await expect(mobileCard.getByTestId("assessment-provenance")).toContainText("deterministic fallback, not live AI");
  await expect(mobileCard).toContainText(result.current_assessment.race.result.decision_summary);
  await page.getByRole("button", { name: "Review current PAY assessment" }).click();
  const mobileRerun = mobileCard.getByRole("button", { name: "Run AI Assessment again" });
  await expect(mobileRerun).toBeVisible();
  expect(await mobileRerun.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
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
      if (viewport.label === "mobile") await page.getByText("View all stages").click();
      await expect(stageButton).toBeVisible();
      await expect(stageButton).not.toBeDisabled();
      await stageButton.click();
      if (viewport.label === "mobile") await page.getByText("View all stages").click();

      const main = page.getByRole("main");
      const primaryActions = main.locator('button[data-primary-action="true"]');
      expect(await primaryActions.count()).toBeLessThanOrEqual(1);
      await expect(main.locator('button[data-obligation-id][aria-current="true"]')).toHaveCount(1);
      if (await primaryActions.count()) {
        expect(await primaryActions.first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
      await expect(main.locator("details[open]")).toHaveCount(0);
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
        await expect(page.getByRole("region", { name: "Approver decision packet" })).toContainText("AI did not authorize this payment");
        await expect(page.getByRole("region", { name: "Approver decision packet" })).toContainText("OUTSTANDING");
      } else if (scenario.stage === "Assurance") {
        await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toContainText("ASSURANCE PASSED");
        await expect(page.getByRole("region", { name: "Arc Testnet assurance and payment gate" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Disable this obligation" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Re-enable" })).toHaveCount(0);
      } else if (scenario.stage === "Payment") {
        await expect(page.getByRole("region", { name: "Payment status" })).toContainText("No execution has been recorded for this instruction.");
        await expect(page.getByRole("region", { name: "Payment status" })).toContainText("Sealed");
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

test("non-winner PAY Assessment explains the authoritative candidate and navigates without writes", async ({ browser }, testInfo) => {
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
    if (viewport.label === "mobile") await page.getByRole("button", { name: /Switch obligation/ }).click();
    await queueItem(page, "OBL-UAT-02").click();
    if (viewport.label === "mobile") await page.getByText("View all stages").click();
    const assessmentStage = page.getByRole("button", { name: "Assessment", exact: true });
    await expect(assessmentStage).toHaveAttribute("data-stage-state", "CURRENT");
    await assessmentStage.click();
    if (viewport.label === "mobile") await page.getByText("View all stages").click();

    const card = page.getByRole("region", { name: "Assessment result" });
    await expect(card).toContainText("Advisory — PAY");
    await expect(card.getByRole("heading", { name: "Payment eligibility" })).toBeVisible();
    await expect(card).toContainText("not the selected payment candidate for the demo");
    await expect(card).toContainText("software services · 125.00 USD");
    await expect(card).toContainText("earliest effective due date among PAY recommendations");
    await expect(card).not.toContainText("OBL-UAT-01");
    await expect(card.getByRole("button", { name: "View selected payment candidate" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Review current PAY assessment" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Continue to Authorization" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Approver decision packet" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Deterministic assurance result" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Payment status" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Reconciliation receipt" })).toHaveCount(0);
    await expect(page.getByRole("main").locator("details[open]")).toHaveCount(0);
    for (const row of await page.locator('button[data-obligation-id]').all()) {
      await expect(row).not.toContainText(/Sole PAY candidate|route assurance|PAE|execution|provider/i);
    }
    await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
    const primaryHeight = await card.getByRole("button", { name: "View selected payment candidate" }).evaluate((element) => element.getBoundingClientRect().height);
    expect(primaryHeight).toBeGreaterThanOrEqual(44);
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    await page.screenshot({ path: testInfo.outputPath(`nonwinner-pay-assessment-${viewport.label}.png`), fullPage: true });

    await card.getByRole("button", { name: "View selected payment candidate" }).click();
    await expect(queueItem(page, "OBL-UAT-01")).toHaveAttribute("aria-current", "true");
    expect(unexpectedWrites).toEqual([]);
    await page.close();
  }
});

test("fresh PAY after proxy preparation does not show stale PAE recovery on desktop or mobile", async ({ browser }, testInfo) => {
  const freshPay = postProxyFreshPayWithAggregateRevoked();

  for (const viewport of [{ width: 1280, height: 900, label: "desktop" }, { width: 390, height: 844, label: "mobile" }]) {
    const page = await browser.newPage({ viewport });
    const unexpectedWrites = await openFixture(page, freshPay);
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review current PAY assessment" })).toBeVisible();
    await expect(page.getByTestId("current-next-step")).toContainText("Review current PAY assessment");
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-screen-1-${viewport.label}.png`), fullPage: true });
    if (viewport.label === "mobile") await page.getByText("View all stages").click();
    await page.getByRole("button", { name: "Assessment", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("Advisory — PAY");
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Assessment result" }).getByRole("button", { name: "Review current PAY assessment" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Assessment result" })).toContainText("Review this advisory recommendation");
    expect(await page.locator('main button[data-primary-action="true"]').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`fresh-pay-screen-2-before-review-${viewport.label}.png`), fullPage: true });
    await page.getByRole("region", { name: "Assessment result" }).getByRole("button", { name: "Review current PAY assessment" }).click();
    await expect(page.getByRole("region", { name: "Exception recovery" })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue to Authorization" }).click();
    await expect(page.getByText("Eligible for human authorization review")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Obligation" })).toHaveAttribute("aria-pressed", "true");
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
  const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
  await expect(lifecycle.locator("li button > span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await expect(lifecycle).toContainText("Approval locked — route assurance not ready");
  await expect(lifecycle.locator('[aria-current="step"]')).toContainText("Assessment");
  await expect(page.getByTestId("current-next-step")).toContainText("Current position: Assessment");
  await expect(page.getByTestId("current-next-step")).toContainText("payment-route assurance is not ready and authorization remains locked");
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
  await expect(sourceProxy).toContainText("real-world payable remains OUTSTANDING");
  await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(0);
  await queueItem(page, "OBL-UAT-02").click();
  await expect(page.getByRole("heading", { name: "software services" })).toBeVisible();
  await expect(sourceProxy).not.toContainText("OBL-UAT-02");
  await expect(sourceProxy).toContainText("40.00 USD");
  await expect(sourceProxy).toContainText("real-world payable remains OUTSTANDING");
  await expect(sourceProxy).not.toContainText("OBL-UAT-01");
  await expect(page.getByText("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.")).toBeHidden();
  await expect(lifecycle).toContainText("Approval locked — route assurance not ready");
  await queueItem(page, "OBL-UAT-03").click();
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("125.000000 USDC");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("real-world payable remains OUTSTANDING");
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
    { paeSealed: false, expectedStage: "Assurance", expectedStatus: "Assurance failed or blocked; no PASS assurance is available", expectedGuidance: "Authorization recorded · Assurance failed/blocked" },
    { paeSealed: true, expectedStage: "Assurance", expectedStatus: "No current exact execution packet is available. Payment authority must be re-established before submission.", expectedGuidance: "No current exact execution packet is available. Payment authority must be re-established before submission." },
  ]) {
    const queue = [{ ...obligation, assessed: false, decision: null, provider_mode: null }];
    const writes = await openFixture(page, postApprovalNPlusOneDetail(scenario.paeSealed), queue);
    const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
    await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
    await expect(lifecycle.locator('[aria-current="step"]')).toContainText(scenario.expectedStage);
    await expect(lifecycle).toContainText(scenario.paeSealed ? "PaymentLocked" : "AssuranceBlocked");
    await expect(page.getByTestId("current-next-step")).toContainText(scenario.expectedGuidance);
    if (scenario.paeSealed) {
      await page.screenshot({ path: testInfo.outputPath("sealed-no-current-packet.png") });
    }
    await expect(page.getByRole("button", { name: "Run AI Assessment" })).toHaveCount(0);
    await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Payment" })).toBeDisabled();
    expect(writes).toEqual([]);
    await page.unrouteAll();
  }
});

test("the permitted proxy-preparation step and its reason fit the first desktop viewport", async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1188, height: 761 });
  const writes = await openFixture(page, liveWinnerForPreparation());
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("OUTSTANDING");
  await expect(page.getByTestId("current-next-step")).toContainText("Current PAY is eligible for read-only proxy preparation");
  await expect(page.getByTestId("current-next-step")).toContainText("fresh assessment");
  await expect(page.getByTestId("current-next-step")).toContainText("fresh assessment and review follow");
  await expect(page.getByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toBeVisible();
  await expect(page.getByTestId("current-next-step")).toContainText("Next owner: Authorized operator");
  const firstViewport = await page.evaluate(() => {
    const step = document.querySelector('[data-testid="current-next-step"]');
    const reason = step?.querySelector("h3") ?? null;
    const guidance = Array.from(step?.querySelectorAll("p") ?? []).find((element) => element.textContent?.includes("Current PAY is eligible for read-only proxy preparation")) ?? null;
    const actor = Array.from(step?.querySelectorAll("p") ?? []).find((element) => element.textContent?.includes("Next owner:")) ?? null;
    const elements = [
      { name: "selected source identity", element: document.querySelector('[aria-label="Selected source obligation"] h2') },
      { name: "current lifecycle stage", element: document.querySelector('[aria-label="Payment lifecycle"] [aria-current="step"]') },
      { name: "current reason", element: reason },
      { name: "permitted-action guidance", element: guidance },
      { name: "next actor", element: actor },
      { name: "permitted primary action", element: step?.querySelector('button[data-primary-action="true"]') ?? null },
    ];
    return elements.map(({ name, element }) => {
      const rect = element?.getBoundingClientRect();
      return { name, exists: Boolean(element), top: rect?.top ?? null, bottom: rect?.bottom ?? null };
    });
  });
  const primaryHeight = await page.locator('[data-testid="current-next-step"] button[data-primary-action="true"]').evaluate((element) => element.getBoundingClientRect().height);
  expect(primaryHeight).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("desktop-short-after.png") });
  expect(firstViewport.every((element) => element.exists && element.top! >= 0 && element.bottom! <= 761), JSON.stringify(firstViewport)).toBe(true);
  await expect(page).toHaveScreenshot("command-center-desktop-short.png", { animations: "disabled" });
  expect(writes).toEqual([]);
});

test("sealed, submitted, unknown and reconciled proxy states preserve source truth", async ({ page }) => {
  const scenarios = [
    { state: "AUTHORIZED" as const, lifecycle: "Approved instruction is sealed for the Arc Testnet settlement proxy", position: "Assurance", actor: "Prime · exact-packet authorization", action: null },
    { state: "SUBMITTED" as const, lifecycle: "The Arc Testnet submission is recorded. Reconcile this same intent; do not resubmit.", position: "Reconciliation", actor: "Unassigned · read-only reconciliation", action: "Reconcile this same intent" },
    { state: "UNKNOWN" as const, lifecycle: "The Arc Testnet outcome is unknown. Reconcile this same intent read-only; do not resubmit.", position: "Reconciliation", actor: "Unassigned · read-only reconciliation", action: "Reconcile this same intent" },
    { state: "SETTLED" as const, lifecycle: "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION. The source payable remains OUTSTANDING.", position: "Reconciliation", actor: "Reconciliation record", action: "View reconciliation receipt" },
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: 1280, height: 1500 });
    const writes = await openFixture(page, proxyLifecycleDetail(scenario.state));
    const summary = page.getByRole("region", { name: "Selected source obligation" });
    await expect(summary).toContainText("125.00 USD");
    await expect(summary).toContainText("OUTSTANDING");
    await expect(summary).toContainText("controlled settlement proxy");
    await expect(summary).toContainText("125.000000 USDC");
    await expect(summary).toContainText("ARC_TESTNET");
    const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
    await expect(page.getByTestId("current-next-step")).toContainText(scenario.lifecycle);
    await expect(page.getByTestId("current-next-step")).toContainText(`Current position: ${scenario.position}`);
    await expect(page.getByTestId("current-next-step")).toContainText(`Next owner: ${scenario.actor}`);
    if (scenario.action) {
      await expect(page.getByRole("button", { name: scenario.action })).toBeVisible();
    } else {
      await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
    }
    if (scenario.state !== "AUTHORIZED") {
      await expect(page.getByRole("button", { name: /^Continue to / })).toHaveCount(0);
    }
    if (scenario.state === "AUTHORIZED") {
      await expect(page.getByRole("button", { name: "Payment" })).toHaveAttribute("data-stage-state", "AVAILABLE");
      await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Assurance" }).click();
      await expect(page.getByRole("button", { name: "Continue to Payment" }).first()).toBeVisible();
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
  await expect(page.getByRole("button", { name: /Switch obligation/ })).toBeVisible();
  const assertMobileTarget = async (locator: ReturnType<typeof page.getByRole> | ReturnType<typeof page.locator>, label: string) => {
    expect(await locator.evaluate((element) => element.getBoundingClientRect().height), `${label} mobile target`).toBeGreaterThanOrEqual(44);
  };
  await assertMobileTarget(page.getByRole("button", { name: /Switch obligation/ }), "Switch obligation");
  await expect(queueItem(page, "OBL-UAT-01")).toBeHidden();
  await page.getByRole("button", { name: /Switch obligation/ }).click();
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
  await assertMobileTarget(page.locator("summary").filter({ hasText: "View all stages" }), "View all stages");
  const mobileBack = page.getByRole("button", { name: "Back" });
  await expect(mobileBack).toBeVisible();
  expect(await mobileBack.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.getByText("View all stages").click();
  const lifecycle = page.getByRole("navigation", { name: "All lifecycle stages" });
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
  await expect(page.getByRole("navigation", { name: "All lifecycle stages" }).getByRole("button", { name: "Authorization" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("125.00 USD");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("real-world payable remains OUTSTANDING");
  await page.getByText("View all stages").click();
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

test("mobile Continue is a 44px read-only navigation control when Assurance is current", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await openFixture(page, proxyLifecycleDetail("AUTHORIZED"));
  await expect(page.getByText("Step 1 of 6 · Obligation")).toBeVisible();
  await page.getByText("View all stages").click();
  await page.getByRole("navigation", { name: "All lifecycle stages" }).getByRole("button", { name: "Assurance" }).click();
  await expect(page.getByText("Step 4 of 6 · Assurance")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue to Payment" }).last();
  await expect(continueButton).toBeVisible();
  expect(await continueButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const before = writes.length;
  await continueButton.click();
  await expect(page.getByText("Step 5 of 6 · Payment")).toBeVisible();
  expect(writes.slice(before)).toEqual([]);
  expect(page.getByRole("button", { name: "Execute Test Payment" })).toHaveCount(0);
});

test("active kill switch takes precedence over a waiting exact-packet gate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const suspended = proxyLifecycleDetail("AUTHORIZED");
  suspended.execution_kill_switched = true;
  const writes = await openFixture(page, suspended);
  await expect(page.getByRole("button", { name: "Payment" })).toHaveAttribute("data-stage-state", "BLOCKED");
  await page.getByRole("navigation", { name: "Payment lifecycle navigation" }).getByRole("button", { name: "Payment" }).click();
  await expect(page.getByRole("region", { name: "Payment status" })).toContainText("A payment stop is active. No execution is permitted.");
  await expect(page.getByTestId("current-next-step")).toContainText("Execution is suspended while a kill switch is active");
  await expect(page.getByTestId("current-next-step")).not.toContainText("Prime · exact-packet authorization");
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
    if (viewport.label === "mobile") await page.getByText("View all stages").click();
    await page.getByRole("button", { name: "Payment", exact: true }).click();

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
