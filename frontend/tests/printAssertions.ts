import { expect, type Page } from "@playwright/test";

export async function expectPrintLinesWithin32(page: Page) {
  const text = await page.locator("pre[data-testid='print-lines']").textContent();
  expect(text).toBeTruthy();
  for (const line of (text ?? "").split("\n")) {
    expect(line.length).toBeLessThanOrEqual(32);
    expect([...line].every((character) => character.charCodeAt(0) <= 127)).toBe(true);
  }
}
