import { expect, test } from "./network-fence";

test("withdrawn runtime source stays empty without synthetic fallback", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method());
  });
  // These are actual local server reads, without the synthetic runner fixture.
  const list = await page.request.get("/api/obligations");
  expect(list.status()).toBe(200);
  expect((await list.json()).obligations).toEqual([]);
  const detail = await page.request.get("/api/obligations/OBL-J0C-001");
  expect(detail.status()).toBe(404);
  await page.goto("/");
  await expect(page.getByText("Genuine records are withheld from this candidate for privacy review. No synthetic records have been added to this queue.")).toBeVisible();
  await expect(page.locator("button[data-obligation-id]")).toHaveCount(0);
  expect(writes).toEqual([]);
});
