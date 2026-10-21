import { expect, test } from "@playwright/test";
import { seedUser, signIn } from "./helpers";

test("keyboard shortcuts, legacy links and the not found page", async ({ page, request }) => {
  const user = await seedUser(request);
  await signIn(page, user);
  await page.goto("/#/history");
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("heading", { name: "Programs" })).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.getByRole("heading", { name: "Exercises" })).toBeVisible();
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("every desktop page renders without errors", async ({ page, request }) => {
  const user = await seedUser(request);
  await signIn(page, user);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, heading] of [
    ["/", null],
    ["/programs", "Programs"],
    ["/exercises", "Exercises"],
    ["/equipment", "Equipment"],
    ["/history", "History"],
    ["/coach", "Coach"],
    ["/leaderboard", "Leaderboard"],
    ["/trainer", "My coach"],
    ["/profile", user.name],
  ] as const) {
    await page.goto(path);
    if (heading) await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    else await expect(page.locator(".today-card")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
