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

async function openFixture(page: Page) {
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") unexpectedWrites.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/obligations") return route.fulfill({ json: { obligations: [obligation, secondObligation], assessed_count: 2, total_count: 2 } });
    if (url.pathname === "/api/obligations/OBL-UAT-01") return route.fulfill({ json: detail });
    if (url.pathname === "/api/obligations/OBL-UAT-02") return route.fulfill({ json: detailFor("OBL-UAT-02", "40.00", "2026-10-10", "UAT-INV-02") });
    if (url.pathname === "/api/internal/demo/real-testnet-payment/status") return route.fulfill({ json: {
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      organization_id: "ORG-TAMEION-TESTNET-DEMO", obligation_id: "DEMO-ARC-TESTNET-001",
      source_amount: "5.00", settlement_amount: "5.000000", asset: "USDC", network: "ARC_TESTNET",
      demo_obligation: null, intent_identity: null,
      lifecycle: [
        { stage: "Obligation", status: "NOT_CREATED" },
        { stage: "AI Assessment", status: "NOT_ASSESSED" },
        { stage: "Assurance & Authorization", status: "NOT_AUTHORIZED" },
        { stage: "Execution", status: "NOT_SUBMITTED" },
        { stage: "Reconciliation & Evidence", status: "NOT_SUBMITTED" },
      ],
      preflight: null, aggregate_version: null, current_assessment: null,
      authorization: null, execution: null, execution_gate: "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION", execution_packet: null,
    } });
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
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /OBL-UAT-01/ })).toContainText("PAY recommendation (advisory)");
  await expect(page.getByRole("button", { name: "Obligations" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No payment intent created")).toBeVisible();
  const lifecycle = page.getByRole("list", { name: "Payment lifecycle" });
  await expect(lifecycle.locator("li div span:nth-child(2)")).toHaveText([
    "Obligation", "Assessment", "Authorization", "Assurance", "Payment", "Reconciliation",
  ]);
  await expect(lifecycle).toContainText("Blocked — no Arc payment binding for this obligation");
  await expect(lifecycle.locator('[aria-current="step"]')).toContainText("Authorization");
  await expect(page.getByText(/Current step: Authorization\. Next step: review the current PAY assessment; payment-route assurance is not ready and authorization remains locked/)).toBeVisible();
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
  await page.getByText("Arc Testnet", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Arc Testnet demonstration" })).toContainText("DEMO-ARC-TESTNET-001");
  await page.getByRole("button", { name: /OBL-UAT-02/ }).click();
  await expect(page.getByRole("heading", { name: "OBL-UAT-02" })).toBeVisible();
  await page.getByRole("navigation", { name: "Command Center surfaces" }).getByRole("button", { name: "Obligations" }).click();
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toContainText("UAT-INV-02");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toContainText("≈ 40.000000 USDC");
  await expect(page.getByRole("region", { name: "Arc Testnet demonstration" })).toContainText("DEMO-ARC-TESTNET-001");
  await expect(lifecycle).toContainText("Blocked — no Arc payment binding for this obligation");
  await page.getByText("Arc Testnet", { exact: true }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  await page.getByText("Demonstrations", { exact: true }).click();
  const stageBoxes = await lifecycle.getByRole("listitem").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(stageBoxes[0]).toBeGreaterThan(stageBoxes[1]);
  expect(await page.locator(".tabular").first().evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
  const nav = page.getByRole("navigation", { name: "Command Center surfaces" });
  await nav.getByRole("button", { name: "Assessment" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Assessment" })).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Obligations" }).focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  await page.mouse.move(1, 1);
  await expect(page).toHaveScreenshot("command-center-desktop.png", { fullPage: true, animations: "disabled" });
  expect(unexpectedWrites).toEqual([]);
});

test("Command Center mobile layout and review image", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unexpectedWrites = await openFixture(page);
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /OBL-UAT-01/ })).toBeVisible();
  await expect(page.getByText("No payment intent created")).toBeVisible();
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
  await page.getByText("Arc Testnet", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Arc Testnet demonstration" })).toContainText("DEMO-ARC-TESTNET-001");
  await page.getByText("Arc Testnet", { exact: true }).click();
  await page.getByText("Read-only sample", { exact: true }).click();
  await page.getByText("Demonstrations", { exact: true }).click();
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
