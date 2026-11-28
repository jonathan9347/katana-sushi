import { expect, type FrameLocator, type Page } from "@playwright/test";

export function receiptPrintContent(page: Page): FrameLocator {
  return page.frameLocator('iframe[data-receipt-print-frame="true"]:last-of-type');
}

export async function expectReceiptPrint(page: Page, title?: string) {
  await expect(page.locator("body")).toHaveAttribute("data-print-requested", "true");
  const frame = page.locator('iframe[data-receipt-print-frame="true"]').last();
  await expect(frame).toBeAttached();
  if (title) await expect(frame).toHaveAttribute("title", title);
  return receiptPrintContent(page);
}

export async function finishReceiptPrint(page: Page) {
  await page.locator('iframe[data-receipt-print-frame="true"]').last().evaluate((element) => {
    (element as HTMLIFrameElement).contentWindow?.dispatchEvent(new Event("afterprint"));
  });
}

export async function expectPrintLinesWithin32(frame: FrameLocator) {
  const text = await frame.locator(".plain-lines").textContent();
  expect(text).toBeTruthy();
  for (const line of (text ?? "").split("\n")) {
    expect(line.length).toBeLessThanOrEqual(32);
    expect([...line].every((character) => character.charCodeAt(0) <= 127)).toBe(true);
  }
}
