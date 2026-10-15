import { expect, test } from "./network-fence";

test("anonymous private reads are denied without synthetic fallback", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method());
  });
  // These are actual local server reads, without the synthetic runner fixture.
  const list = await page.request.get("/api/obligations");
  expect(list.status()).toBe(503);
  expect(list.headers()["cache-control"]).toContain("no-store");
  expect(await list.json()).toMatchObject({code:"AUTH_UNAVAILABLE"});
  const detail = await page.request.get("/api/obligations/OBL-J0C-001");
  expect(detail.status()).toBe(503);
  expect(await detail.json()).toMatchObject({code:"AUTH_UNAVAILABLE"});
  const packet = await page.request.get("/api/obligations/OBL-J0C-001/prime-approval-packet");
  expect(packet.status()).toBe(503);
  expect(await packet.json()).toMatchObject({code:"AUTH_UNAVAILABLE"});
  await page.goto("/");
  await expect(page.getByRole("button",{name:"Sign in securely"})).toBeVisible();
  await expect(page.locator("button[data-obligation-id]")).toHaveCount(0);
  expect(writes).toEqual([]);
});
