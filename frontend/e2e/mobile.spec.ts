import { expect, test } from "@playwright/test";
import { seedUser } from "./helpers";

test("a phone workout uses the dock and the exercise dots", async ({ page, request }) => {
  const user = await seedUser(request, "female");
  await page.addInitScript((id) => {
    window.localStorage.setItem("user-id", String(id));
  }, user.id);
  await page.goto("/");
  await expect(page).toHaveURL(/\/m$/);
  await expect(page.getByRole("heading", { name: "Hi " + user.name })).toBeVisible();
  await expect(page.locator("#cycle-card")).toBeVisible();

  await page.getByRole("link", { name: "Train" }).click();
  await page.getByRole("button", { name: /Push Day/ }).click();
  await expect(page).toHaveURL(/\/m\/train\/preview\//);
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.locator(".coach-overlay").getByRole("button", { name: "Let's go" }).click();

  await expect(page.locator(".mw-dock")).toBeVisible();
  await expect(page.locator(".m-tabs")).toBeHidden();
  const dots = page.getByRole("tablist", { name: "Exercises" }).getByRole("tab");
  await expect(dots).toHaveCount(2);
  await page.locator(".mw-dock").getByRole("button", { name: "More kg" }).click();
  await expect(page.locator("#mw-weight")).toHaveValue("22.5");
  await page.locator(".mw-dock").getByRole("button", { name: "Save set" }).click();
  await page.getByRole("dialog", { name: "Rest timer" }).getByRole("button", { name: /Continue/ }).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("dialog", { name: "Finish workout" }).getByRole("button", { name: "Save workout" }).click();
  await page.locator(".coach-overlay").getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/m$/);
});

test("the health page is protected by a PIN", async ({ page, request }) => {
  const user = await seedUser(request, "female");
  await page.addInitScript((id) => {
    window.localStorage.setItem("user-id", String(id));
  }, user.id);
  await page.goto("/m/more/health");
  await page.getByLabel("PIN", { exact: true }).fill("2468");
  await page.getByLabel("Repeat PIN").fill("2468");
  await page.getByRole("button", { name: "Set PIN" }).click();
  await expect(page.getByRole("heading", { name: "Next period" })).toBeVisible();
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("heading", { name: "Enter your health PIN" })).toBeVisible();
});
