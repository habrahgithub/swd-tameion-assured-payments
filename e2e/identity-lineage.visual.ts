import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";
import { GET as getObligationList } from "../app/api/obligations/route";
import { DEMO_ORGANIZATION_ID, DemoState } from "../src/server/demo-state";
import { J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import type { J2aCircleClient } from "../src/execution/provider-adapter";
import { sealTestAssessment } from "../tests/test-support/seal-assessment";

async function genuinePreparedReadModel() {
  const state = new DemoState();
  const selected = state.liveUsageRecords.find((record) => record.obligation_id === "OBL-J0C-001");
  if (!selected) throw new Error("The frozen genuine source set is missing OBL-J0C-001.");

  for (const record of state.liveUsageRecords) {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, record.obligation_id);
    if (!aggregate) throw new Error(`No aggregate exists for ${record.obligation_id}.`);
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, aggregate.aggregate_version, {
      decision: "PAY",
      provider_mode: "LIVE_AI",
      reasons: ["Controlled browser fixture: test-seeded LIVE_AI state for the existing proxy-preparation gate; no live AI call was made."],
    });
  }

  const mockedProvider: J2aCircleClient = {
    getWallet: async ({ id }) => ({ data: { wallet: {
      id,
      address: id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address,
      blockchain: "ARC-TESTNET",
      walletSetId: J2A_DEMO_WALLET_SET_ID,
      state: "LIVE",
    } } }),
    getWalletTokenBalance: async () => ({ data: { tokenBalances: [{
      amount: "10000.000000",
      token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true },
    }] } }),
    estimateTransferFee: async () => ({ data: { medium: { networkFee: "0.001000" } } }),
    listTransactions: async () => ({ data: { transactions: [] } }),
    getTransaction: async () => ({ data: { transaction: undefined } }),
    createTransaction: async () => { throw new Error("Transaction creation is forbidden in this read-only capture fixture."); },
  };
  const preflight = await runJ2aReadOnlyPreflight(
    mockedProvider,
    () => new Date("2026-10-08T12:00:00.000Z"),
    state.createSettlementProxyIntent(selected.obligation_id),
  );
  if (preflight.readiness !== "READY") throw new Error(`Controlled mocked preflight was blocked: ${preflight.readiness}`);
  state.bindSettlementProxy(preflight, state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id).aggregate_version);
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id);
  sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, selected.obligation_id, aggregate.aggregate_version, {
    decision: "PAY",
    provider_mode: "LIVE_AI",
    reasons: ["Controlled browser fixture: test-seeded LIVE_AI state for the existing proxy-preparation gate; no live AI call was made."],
  });

  (globalThis as typeof globalThis & { __tameionDemoState?: DemoState }).__tameionDemoState = state;
  const listResponse = await getObligationList();
  if (!listResponse.ok) throw new Error("Actual obligation list GET failed in the isolated browser fixture.");
  const list = await listResponse.json();
  const details: Record<string, any> = {};
  for (const record of state.liveUsageRecords) {
    const response = await getObligationDetail(
      new Request(`http://localhost/api/obligations/${record.obligation_id}`),
      { params: Promise.resolve({ id: record.obligation_id }) },
    );
    if (!response.ok) throw new Error(`Actual detail GET failed for ${record.obligation_id}.`);
    details[record.obligation_id] = await response.json();
  }
  return { state, list, details, preflight };
}

async function openAllStages(page: Page) {
  const toggle = page.getByRole("button", { name: "View all stages", exact: true });
  if (await toggle.count() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}

async function gotoStage(page: Page, label: string) {
  await openAllStages(page);
  const nav = page.getByRole("navigation", { name: "Payment lifecycle navigation" });
  await nav.getByRole("button", { name: label, exact: true }).click();
}

async function capture(page: Page, testInfo: TestInfo, name: string, width: number, height: number, state: string, fontMode = "product-default") {
  await page.evaluate(() => window.scrollTo(0, 0));
  const image = await page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
  const primary = page.locator('main button[data-primary-action="true"]:not(:disabled)');
  const bounds = await primary.evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { label: (item as HTMLButtonElement).innerText.trim(), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  }));
  const metadata = {
    file: name,
    image_sha256: createHash("sha256").update(image).digest("hex"),
    fixture: state,
    viewport: { width, height },
    scrollY: await page.evaluate(() => window.scrollY),
    primary_action_count: bounds.length,
    primary_actions: bounds,
    navigation_mutations: 0,
    computed_font: await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
    font_mode: fontMode,
    disclosures_open: await page.locator("main details[open]").count(),
  };
  console.log("IDENTITY_LINEAGE_CAPTURE", JSON.stringify(metadata));
  return metadata;
}

test("real-record Authorization lineage and 003 candidate remain distinct in desktop and mobile browser views", async ({ page, browser }, testInfo) => {
  const fixture = await genuinePreparedReadModel();
  const mutations: string[] = [];
  await page.route("**/api/obligations**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 403, json: { error: "Read-only browser capture fixture." } });
      return;
    }
    if (path === "/api/obligations") {
      await route.fulfill({ status: 200, json: fixture.list });
      return;
    }
    const id = decodeURIComponent(path.slice("/api/obligations/".length));
    const body = fixture.details[id];
    await route.fulfill(body ? { status: 200, json: body } : { status: 404, json: { error: "Fixture record unavailable." } });
  });

  await page.setViewportSize({ width: 1173, height: 751 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Genuine obligation workspace" })).toBeVisible();
  await page.locator('button[data-obligation-id="OBL-J0C-001"]').click();
  await gotoStage(page, "Assessment");
  const assessmentDetail = fixture.details["OBL-J0C-001"];
  expect(assessmentDetail.current_assessment.provider_mode).toBe("LIVE_AI");
  await page.getByRole("button", { name: "Review current PAY assessment" }).click();
  await gotoStage(page, "Authorization");
  const packet = page.getByRole("region", { name: "Approver decision packet" });
  await expect(packet).toContainText("OBL-J0C-001");
  await expect(packet).toContainText("CP-J0C-001");
  await expect(packet).toContainText("EVID-J0C-001-A");
  await expect(packet).toContainText("5760.00 AED");
  await expect(packet).toContainText("1568.413887 USDC");
  await expect(packet).toContainText("OUTSTANDING");
  await expect(packet).toContainText("Supplier name is not included in this public demo record");
  await expect(packet.getByRole("region", { name: "Source obligation lineage" })).not.toContainText(fixture.details["OBL-J0C-001"].aggregate.counterparty_id);
  await expect(packet).toContainText("Controlled Arc Testnet proxy, not the source supplier.");
  await expect(packet).toContainText("testnet execution does not discharge the real-world payable");
  await expect(page.getByRole("button", { name: "Authorize payment" })).toBeVisible();
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
  await new AxeBuilder({ page }).analyze().then((result) => expect(result.violations).toEqual([]));
  await capture(page, testInfo, "authorization-001-desktop-top.png", 1173, 751, "actual DemoState detail GET; source 001; test-seeded LIVE_AI mode surrogate with no AI request; mocked read-only Circle preflight transport; no authorization/PAE");
  const fullDesktop = await page.screenshot({ path: testInfo.outputPath("authorization-001-desktop-full.png"), fullPage: true });
  console.log("IDENTITY_LINEAGE_CAPTURE", JSON.stringify({ file: "authorization-001-desktop-full.png", image_sha256: createHash("sha256").update(fullDesktop).digest("hex"), viewport: { width: 1173, height: 751 }, full_page: true, source_obligation: "OBL-J0C-001", navigation_mutations: mutations.length }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, testInfo, "authorization-001-mobile-top.png", 390, 844, "actual DemoState detail GET; source 001; test-seeded LIVE_AI mode surrogate with no AI request; mocked read-only Circle preflight transport; no authorization/PAE");
  const fullMobile = await page.screenshot({ path: testInfo.outputPath("authorization-001-mobile-full.png"), fullPage: true });
  console.log("IDENTITY_LINEAGE_CAPTURE", JSON.stringify({ file: "authorization-001-mobile-full.png", image_sha256: createHash("sha256").update(fullMobile).digest("hex"), viewport: { width: 390, height: 844 }, full_page: true, source_obligation: "OBL-J0C-001", navigation_mutations: mutations.length }));
  await page.addStyleTag({ content: "html, body, body * { font-family: 'DejaVu Sans', sans-serif !important; }" });
  await capture(page, testInfo, "authorization-001-mobile-dejavu.png", 390, 844, "actual DemoState detail GET; source 001; test-seeded LIVE_AI mode surrogate; mocked preflight; no AI/provider/authorization/PAE action", "DejaVu Sans test-only font override; font installed in runner");
  const mobileDejaVuFull = await page.screenshot({ path: testInfo.outputPath("authorization-001-mobile-dejavu-full.png"), fullPage: true });
  console.log("IDENTITY_LINEAGE_CAPTURE", JSON.stringify({ file: "authorization-001-mobile-dejavu-full.png", image_sha256: createHash("sha256").update(mobileDejaVuFull).digest("hex"), viewport: { width: 390, height: 844 }, full_page: true, font_mode: "DejaVu Sans test-only font override" }));

  await page.setViewportSize({ width: 1173, height: 751 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, testInfo, "authorization-001-desktop-dejavu.png", 1173, 751, "actual DemoState detail GET; source 001; test-seeded LIVE_AI mode surrogate; mocked preflight; no AI/provider/authorization/PAE action", "DejaVu Sans test-only font override; font installed in runner");
  const desktopDejaVuFull = await page.screenshot({ path: testInfo.outputPath("authorization-001-desktop-dejavu-full.png"), fullPage: true });
  console.log("IDENTITY_LINEAGE_CAPTURE", JSON.stringify({ file: "authorization-001-desktop-dejavu-full.png", image_sha256: createHash("sha256").update(desktopDejaVuFull).digest("hex"), viewport: { width: 1173, height: 751 }, full_page: true, font_mode: "DejaVu Sans test-only font override" }));

  await page.locator('button[data-obligation-id="OBL-J0C-003"]').click();
  await gotoStage(page, "Assessment");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("5.00 USD");
  await expect(page.getByRole("region", { name: "Selected source obligation" }).locator("h2")).toContainText("cloud infrastructure subscription");
  await expect(page.getByText(/not the selected payment candidate/i)).toBeVisible();
  await expect(page.getByTestId("assessment-result-card")).toContainText("business license and flexi desk");
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
  await capture(page, testInfo, "assessment-003-desktop-nonwinner.png", 1173, 751, "actual DemoState detail GET; source 003; 001 authoritative earliest-due candidate; test-seeded LIVE_AI mode surrogate with no AI request; mocked preflight only for 001", "DejaVu Sans test-only font override; font installed in runner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Switch obligation/ }).click();
  await page.locator('button[data-obligation-id="OBL-J0C-003"]').click();
  await gotoStage(page, "Assessment");
  await expect(page.getByRole("region", { name: "Selected source obligation" })).toContainText("5.00 USD");
  await expect(page.getByRole("region", { name: "Selected source obligation" }).locator("h2")).toContainText("cloud infrastructure subscription");
  await expect(page.getByText(/not the selected payment candidate/i)).toBeVisible();
  await expect(page.getByTestId("assessment-result-card")).toContainText("business license and flexi desk");
  await expect(page.locator('main button[data-primary-action="true"]')).toHaveCount(1);
  await capture(page, testInfo, "assessment-003-mobile-nonwinner.png", 390, 844, "actual DemoState detail GET; source 003; 001 authoritative earliest-due candidate; test-seeded LIVE_AI mode surrogate with no AI request; mocked preflight only for 001", "DejaVu Sans test-only font override; font installed in runner");
  expect(mutations).toEqual([]);
  console.log("IDENTITY_LINEAGE_BROWSER", JSON.stringify({ browser_version: browser.version(), mutations, source_ids: fixture.state.liveUsageRecords.map((record) => record.obligation_id), assessment_transport: "test-seeded LIVE_AI state; no AI request", preflight_transport: "mocked read-only Circle client; no provider request", exact_001_conversion: `${fixture.preflight.source_amount} ${fixture.preflight.source_currency} -> ${fixture.preflight.amount} ${fixture.preflight.asset}`, selected_003_candidate: "OBL-J0C-001" }));
});
