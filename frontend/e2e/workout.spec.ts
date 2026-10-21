import { expect, test } from "@playwright/test";
import { seedUser, signIn } from "./helpers";

test("a full desktop workout logs sets, rests and saves", async ({ page, request }) => {
  const user = await seedUser(request);
  await signIn(page, user);
  await page.goto("/training");
  await page.getByRole("button", { name: /Push Day/ }).click();
  await page.getByRole("dialog", { name: "Push Day" }).getByRole("button", { name: "Start workout" }).click();
  await page.locator(".coach-overlay").getByRole("button", { name: "Let's go" }).click();

  await expect(page.locator(".w-main h1")).toBeVisible();
  await page.getByRole("button", { name: /Save set/ }).click();
  const rest = page.getByRole("dialog", { name: "Rest timer" });
  await expect(rest).toBeVisible();
  await rest.getByRole("button", { name: /Continue/ }).click();
  await expect(rest).toBeHidden();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "All done" })).toBeVisible();
  await page.getByRole("dialog", { name: "All done" }).getByRole("button", { name: "Save workout" }).click();
  await page.locator(".coach-overlay").getByRole("button", { name: "See summary" }).click();
  const summary = page.getByRole("dialog", { name: "Workout saved" });
  await expect(summary).toContainText("2sets");
  await summary.getByRole("button", { name: "Back to overview" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the editor guards unsaved changes", async ({ page, request }) => {
  const user = await seedUser(request);
  await signIn(page, user);
  await page.goto("/programs/" + String(user.programId));
  await page.getByLabel("Name", { exact: true }).fill("Push Day Heavy");
  await page.getByRole("link", { name: "All programs" }).click();
  const guard = page.getByRole("dialog");
  await expect(guard).toContainText("Leave without saving?");
  await guard.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Program saved")).toBeVisible();
  await page.getByRole("link", { name: "All programs" }).click();
  await expect(page.getByRole("link", { name: /Push Day Heavy/ })).toBeVisible();
});
