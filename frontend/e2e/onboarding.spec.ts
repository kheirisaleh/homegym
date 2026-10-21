import { expect, type Page, test } from "@playwright/test";

async function at(page: Page, title: string) {
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("a new person can create a profile and reach the overview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|I am new here)$/ }).click();
  await at(page, "What is your name?");
  await page.getByLabel("Your name").fill("Mira");
  await page.getByRole("button", { name: "Next" }).click();
  await at(page, "Your body");
  await page.locator(".choice.sex-female").click();
  await at(page, "Age, height and weight");
  await page.locator("#o-age").fill("29");
  await page.locator("#o-height").fill("168");
  await page.locator("#o-weight").fill("61");
  await page.getByRole("button", { name: "Next" }).click();
  await at(page, "Have you trained before?");
  await page.locator(".choice-grid .choice").nth(2).click();
  const recent = page.getByRole("button", { name: "Yes", exact: true });
  if (await recent.isVisible()) await recent.click();
  await at(page, "Why do you want to train?");
  await page.getByRole("button", { name: /^Build muscle/ }).click();
  await at(page, "Which muscles matter most to you?");
  await page.getByRole("button", { name: "Skip" }).click();
  await at(page, "How often can you train?");
  await page.getByRole("button", { name: "Next" }).click();
  await at(page, "Choose your coach");
  await page.getByRole("radio", { name: /Lena/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await at(page, "Anything the coach should know?");
  await page.getByRole("button", { name: "Write my program" }).click();
  await at(page, "Ready, Mira");
  await page.locator(".gate").getByRole("button").last().click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.locator(".user-chip")).toContainText("Mira");
});
