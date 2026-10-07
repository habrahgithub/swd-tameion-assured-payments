import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
  current_assessment: { obligation_id: "OBL-UAT-01", assessment_id: "ASM-UAT-01", assessment_hash: "a".repeat(64), aggregate_version: "1", decision: "PAY", reasons: ["Advisory checks passed; route assurance is separate."], provider_mode: "NOT_LIVE_AI" },
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
      source_truth: { ...detail.truth.source_truth, source: { ...detail.truth.source_truth.source, record_id: sourceRecordId } },
      settlement_truth: { ...detail.truth.settlement_truth, settlement_amount: settlementAmount, settlement_atomic_amount: atomicAmount, source_amount: sourceAmount },
    },
    aggregate: { ...detail.aggregate, amount: settlementAmount },
    record: { ...detail.record, obligation_id: obligationId, amount: sourceAmount, due_date: dueDate },
    current_assessment: { ...detail.current_assessment, obligation_id: obligationId, assessment_id: `ASM-${obligationId}`, assessment_hash: "b".repeat(64) },
  };
}

function detailWithProxy() {
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
    execution_gate: status === "AUTHORIZED" ? "WAITING_FOR_PRIME_EXACT_PACKET" : "LOCKED_AFTER_SUBMISSION",
    execution_packet: null,
    sealed_pae_instruction_hash: "d".repeat(64),
    execution: executionStatus ? { status: executionStatus, provider_ref: "MOCK-ARC-REFERENCE" } : null,
  };
}

async function openFixture(page: Page, selectedDetail: Record<string, any> = detail) {
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") unexpectedWrites.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/obligations") return route.fulfill({ json: {
      obligations: [obligation, secondObligation, proxiedObligation],
      assessed_count: 3,
      total_count: 3,
      sole_pay_candidate_id: "OBL-UAT-01",
    } });
    if (url.pathname === "/api/obligations/OBL-UAT-01") return route.fulfill({ json: selectedDetail });
    if (url.pathname === "/api/obligations/OBL-UAT-02") return route.fulfill({ json: detailFor("OBL-UAT-02", "40.00", "2026-10-10", "UAT-INV-02") });
    if (url.pathname === "/api/obligations/OBL-UAT-03") return route.fulfill({ json: detailWithProxy() });
    return route.fulfill({ status: 404, json: { error: "This read-only visual fixture does not permit action requests." } });
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return unexpectedWrites;
}

test("Command Center desktop accessibility and review image", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  const unexpectedWrites = await openFixture(page);
  await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: /OBL-UAT-01/ })).toContainText("PAY recommendation (advisory)");
  await expect(page.getByRole("button", { name: "Obligations" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No payment intent created")).toBeHidden();
  await expect(page.getByText("Source records and payment details")).toBeVisible();
  await expect(page.getByText("Arc Testnet settlement proxy", { exact: true })).toHaveCount(0);
  const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
  await expect(lifecycle.locator("li div span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await expect(lifecycle).toContainText("Blocked — no Arc payment binding for this obligation");
  await expect(lifecycle.locator('[aria-current="step"]')).toContainText("Authorization");
  await expect(page.getByTestId("current-next-step")).toContainText("Current position · Authorization");
  await expect(page.getByTestId("current-next-step")).toContainText("Next step: review the current PAY assessment; payment-route assurance is not ready and authorization remains locked.");
  await page.getByRole("navigation", { name: "Command Center surfaces" }).getByRole("button", { name: "Assessment" }).click();
  await expect(page.getByText("The current PAY recommendation has no review evidence in this detail; authorization remains locked.")).toBeVisible();
  await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(0);
  await page.getByText("Demonstrations", { exact: true }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  const beforePlayback = unexpectedWrites.length;
  await page.getByRole("button", { name: "Show sample playback" }).click();
  const playback = page.getByRole("region", { name: "Read-only sample playback" });
  await expect(playback).toContainText("No approval, assurance, provider call, or settlement is performed");
  await expect(playback.getByRole("region", { name: "Illustrative same-intent branches" })).toContainText("Changed destination branch — expected BLOCK");
  expect(unexpectedWrites.slice(beforePlayback)).toEqual([]);
  await page.getByRole("button", { name: "Hide sample playback" }).click();
  await page.getByRole("navigation", { name: "Command Center surfaces" }).getByRole("button", { name: "Authorization" }).click();
  const sourceProxy = page.getByRole("region", { name: "Genuine obligation and Arc Testnet settlement proxy" });
  await expect(sourceProxy).toContainText("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.");
  await expect(sourceProxy).toContainText("OBL-UAT-01");
  await expect(sourceProxy).toContainText("125.00 USD · OUTSTANDING");
  await expect(sourceProxy).toContainText("Not prepared; no testnet destination has been mapped to this source obligation");
  await expect(page.locator('main button[data-primary-action="true"]:not(:disabled)')).toHaveCount(0);
  await page.getByRole("button", { name: /OBL-UAT-02/ }).click();
  await expect(page.getByRole("heading", { name: "software services" })).toBeVisible();
  await expect(sourceProxy).toContainText("OBL-UAT-02");
  await expect(sourceProxy).toContainText("40.00 USD · OUTSTANDING");
  await expect(sourceProxy).not.toContainText("OBL-UAT-01");
  await expect(page.getByText("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.")).toBeVisible();
  await expect(lifecycle).toContainText("Blocked — no Arc payment binding for this obligation");
  await page.getByRole("button", { name: /OBL-UAT-03/ }).click();
  await expect(sourceProxy).toContainText("125.00 USD · OUTSTANDING");
  await expect(sourceProxy).toContainText("125.000000 USDC");
  await expect(sourceProxy).toContainText("ARC_TESTNET");
  await expect(sourceProxy).toContainText("UAT-ARC-SOURCE · 0x1111111111111111111111111111111111111111");
  await expect(sourceProxy).toContainText("UAT-ARC-PROXY · 0x2222222222222222222222222222222222222222");
  await page.getByRole("button", { name: /OBL-UAT-02/ }).click();
  const stageBoxes = await lifecycle.getByRole("listitem").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(stageBoxes[0]).toBeLessThan(stageBoxes[1]);
  expect(await page.locator(".tabular").first().evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
  const nav = page.getByRole("navigation", { name: "Command Center surfaces" });
  await nav.getByRole("button", { name: "Assessment" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Assessment" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Assessment");
  await nav.getByRole("button", { name: "Obligations" }).focus();
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

test("sealed, submitted, unknown and reconciled proxy states preserve source truth", async ({ page }) => {
  const scenarios = [
    { state: "AUTHORIZED" as const, lifecycle: "Arc Testnet proxy prepared; execution awaits separate exact-packet gate", position: "Payment", actor: "Prime · exact-packet authorization", action: null },
    { state: "SUBMITTED" as const, lifecycle: "Submitted to Arc Testnet provider; reconciliation is pending", position: "Reconciliation", actor: "Unassigned · read-only reconciliation", action: "Reconcile this same intent" },
    { state: "UNKNOWN" as const, lifecycle: "Outcome unknown — reconcile this same intent; resubmission blocked", position: "Reconciliation", actor: "Unassigned · read-only reconciliation", action: "Reconcile this same intent" },
    { state: "SETTLED" as const, lifecycle: "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION; source payable remains OUTSTANDING", position: "Reconciliation", actor: "Reconciliation record", action: "View reconciliation receipt" },
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: 1280, height: 1500 });
    const writes = await openFixture(page, proxyLifecycleDetail(scenario.state));
    const summary = page.getByRole("region", { name: "Selected source obligation" });
    await expect(summary).toContainText("125.00 USD");
    await expect(summary).toContainText("OUTSTANDING");
    await expect(summary).toContainText("Arc Testnet settlement proxy");
    await expect(summary).toContainText("125.000000 USDC");
    await expect(summary).toContainText("ARC_TESTNET");
    const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
    await expect(lifecycle).toContainText(scenario.lifecycle);
    await expect(page.getByTestId("current-next-step")).toContainText(`Current position · ${scenario.position}`);
    await expect(page.getByTestId("current-next-step")).toContainText(scenario.actor);
    if (scenario.action) {
      await expect(page.getByRole("button", { name: scenario.action })).toBeVisible();
    } else {
      await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(0);
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
  const unexpectedWrites = await openFixture(page);
  await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: /Switch obligation/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /OBL-UAT-01/ })).toBeHidden();
  await page.getByRole("button", { name: /Switch obligation/ }).click();
  await expect(page.getByRole("button", { name: /OBL-UAT-01/ })).toBeVisible();
  await page.getByRole("button", { name: "Close obligation list" }).click();
  await expect(page.getByText("No payment intent created")).toBeHidden();
  await expect(page.getByText("Arc Testnet settlement proxy", { exact: true })).toHaveCount(0);
  const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
  await expect(lifecycle.locator("li div span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await page.getByText("Demonstrations", { exact: true }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  const beforePlayback = unexpectedWrites.length;
  await page.getByRole("button", { name: "Show sample playback" }).click();
  const playback = page.getByRole("region", { name: "Read-only sample playback" });
  await expect(playback).toContainText("No approval, assurance, provider call, or settlement is performed");
  await expect(playback.getByRole("region", { name: "Illustrative same-intent branches" })).toContainText("Changed destination branch — expected BLOCK");
  expect(unexpectedWrites.slice(beforePlayback)).toEqual([]);
  await page.getByRole("button", { name: "Hide sample playback" }).click();
  await page.getByRole("navigation", { name: "Command Center surfaces" }).getByRole("button", { name: "Authorization" }).click();
  await expect(page.getByRole("region", { name: "Genuine obligation and Arc Testnet settlement proxy" })).toContainText("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.");
  await expect(page.getByRole("region", { name: "Genuine obligation and Arc Testnet settlement proxy" })).toContainText("125.00 USD · OUTSTANDING");
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
