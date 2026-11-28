import { DEFAULT_RECEIPT_PAPER_SIZE, getPrintProfile, type PrintProfile } from "../../../print/printConfig";

export const PRINT_LINE_WIDTH = 32;

const activePrints = new Set<string>();

export function plainText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

export function wrapPrintText(value: unknown, width = PRINT_LINE_WIDTH) {
  const text = plainText(value);
  if (!text) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let offset = 0; offset < word.length; offset += width) {
        lines.push(word.slice(offset, offset + width));
      }
      continue;
    }

    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function addPrintPair(lines: string[], label: string, value: unknown) {
  lines.push(...wrapPrintText(`${label}: ${plainText(value)}`));
}

export function addPrintAmount(lines: string[], label: string, value: string) {
  const amount = plainText(value);
  const safeLabel = plainText(label);
  if (safeLabel.length + amount.length + 1 <= PRINT_LINE_WIDTH) {
    lines.push(`${safeLabel}${" ".repeat(PRINT_LINE_WIDTH - safeLabel.length - amount.length)}${amount}`);
    return;
  }
  lines.push(...wrapPrintText(safeLabel));
  lines.push(...wrapPrintText(amount));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function stylesheet(profile: PrintProfile) {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${profile.paperWidthMm}mm; background: #fff; color: #000; height: auto; }
    body { font-family: "Courier New", Courier, monospace; font-size: 10px; line-height: 1.7; font-weight: 400; }
    .receipt { width: ${profile.paperWidthMm}mm; padding: ${profile.topPaddingMm}mm ${profile.sidePaddingMm}mm 0; box-sizing: border-box; color: #000; background: #fff; break-inside: avoid; page-break-inside: avoid; }
    .receipt-header { margin: 0 0 3mm; text-align: center; }
    .logo-wrap { width: 100%; margin: 0 auto; }
    .receipt-logo { display: block; width: 100%; height: auto; margin: 0 auto; image-rendering: pixelated; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .receipt-logo-fallback { display: none; font-size: 20px; font-weight: 700; letter-spacing: .2em; text-align: center; }
    .receipt-logo-fallback.is-visible { display: block; }
    .logo { display: block; width: 100%; height: auto; margin: 0 auto; }
    .brand-name { margin-top: 1mm; text-align: center; font-size: 11px; font-weight: 700; letter-spacing: .2em; }
    .receipt-title { margin: 1mm 0 0; text-align: center; font-size: 14px; line-height: 1.7; font-weight: 700; letter-spacing: .06em; }
    .order-title { font-size: 16.5px; letter-spacing: 0; }
    .not-a-receipt { width: max-content; max-width: 100%; margin: 1mm auto 2mm; border: 2px solid #000; padding: 0 5px; text-align: center; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
    .inverse-block { margin: 2mm 0; padding: 2mm; background: #000; color: #fff; text-align: center; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .table-block { width: 100%; font-size: 20px; letter-spacing: .1em; }
    .paid-block { width: max-content; margin: 2mm auto; padding: 4px 16px; font-size: 14px; }
    .status-block { width: 100%; font-size: 12px; letter-spacing: .1em; }
    .plain-inverse .inverse-block { border: 2px solid #000; background: #fff; color: #000; }
    .reprint-label { margin: 1mm 0; text-align: center; font-weight: 700; letter-spacing: .12em; }
    .label-value { min-width: 0; margin: 2mm 0; }
    .label { display: block; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
    .value { display: block; overflow-wrap: anywhere; font-weight: 700; }
    .receipt-section { margin-top: 3mm; }
    .section-title { display: table; margin: 0 0 2mm; border-bottom: 2px solid #000; font-size: 9px; line-height: 1.7; font-weight: 700; letter-spacing: .2em; }
    .receipt-row { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 4px; padding: 1mm 0; line-height: 1.7; }
    .row-label { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
    .row-value { max-width: 55%; flex: 0 1 auto; overflow-wrap: anywhere; text-align: right; }
    .row-value.amount { max-width: none; flex: 0 0 auto; white-space: nowrap; }
    .strong { font-weight: 700; }
    .item-row { display: grid; min-width: 0; grid-template-columns: 7mm minmax(0, 1fr) max-content; align-items: start; gap: 1mm; margin: 1mm 0; }
    .item-quantity { font-weight: 700; }
    .item-name { min-width: 0; overflow-wrap: anywhere; }
    .item-note { display: block; padding-left: 2mm; overflow-wrap: anywhere; font-size: 9px; }
    .item-amount { white-space: nowrap; text-align: right; font-weight: 700; }
    .divider { height: 0; margin: 2mm 0; border-top: 1px dashed #000; }
    .heavy-divider { height: 0; margin: 2mm 0; border-top: 4px double #000; }
    .total-block { margin: 2mm 0; text-align: center; }
    .total-label { display: block; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
    .total-amount { display: block; overflow-wrap: anywhere; font-size: 20px; line-height: 1.7; font-weight: 700; }
    .receipt-thanks { margin: 1mm 0; overflow-wrap: anywhere; text-align: center; font-size: 9px; }
    .strong-thanks { font-weight: 700; }
    .booking-status { margin: 0 0 2mm; text-align: center; font-size: 9px; }
    .payment-history-entry { margin: 1mm 0; }
    .payment-reference { margin: 0; padding-left: 7mm; font-size: 9px; overflow-wrap: anywhere; }
    .receipt-feed { height: 0; }
    .plain-lines { width: 100%; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      .receipt { break-inside: avoid; page-break-inside: avoid; }
      .inverse-block { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

function buildDocument(title: string, content: string, profile: PrintProfile) {
  const blockClass = profile.inverseBlocks ? "" : "plain-inverse";
  return `<!doctype html>
    <html class="${blockClass}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>${stylesheet(profile)}</style>
      </head>
      <body><main class="receipt">${content}</main></body>
    </html>`;
}

function imageReady(image: HTMLImageElement) {
  if (image.complete) {
    if (image.naturalWidth === 0) return Promise.resolve(false);
    return image.decode().then(() => true).catch(() => image.naturalWidth > 0);
  }

  let timeout = 0;
  const loaded = new Promise<boolean>((resolve) => {
    image.addEventListener("load", () => resolve(image.naturalWidth > 0), { once: true });
    image.addEventListener("error", () => resolve(false), { once: true });
  });
  const decoded = image.decode
    ? image.decode().then(() => true).catch(() => loaded)
    : loaded;
  const timedOut = new Promise<false>((resolve) => {
    timeout = window.setTimeout(() => resolve(false), 3000);
  });
  return Promise.race([decoded, loaded, timedOut]).finally(() => window.clearTimeout(timeout));
}

function showLogoFallback(image: HTMLImageElement) {
  const fallback = image.parentElement?.querySelector<HTMLElement>(".receipt-logo-fallback");
  if (fallback) fallback.classList.add("is-visible");
  image.remove();
}

export function printReceiptDocument(options: {
  key: string;
  title: string;
  content: string;
  paperSize?: string;
  onAfterPrint?: () => void;
  onError?: (error: unknown) => void;
}) {
  if (activePrints.has(options.key)) return false;
  activePrints.add(options.key);

  let profile: PrintProfile;
  try {
    profile = getPrintProfile(options.paperSize ?? DEFAULT_RECEIPT_PAPER_SIZE);
  } catch (error) {
    activePrints.delete(options.key);
    options.onError?.(error);
    return false;
  }

  const frame = document.createElement("iframe");
  frame.dataset.receiptPrintFrame = "true";
  frame.title = options.title;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    activePrints.delete(options.key);
    options.onError?.(new Error("The receipt print frame could not be created."));
    return false;
  }

  frameDocument.open();
  frameDocument.write(buildDocument(options.title, options.content, profile));
  frameDocument.close();

  let cleaned = false;
  let fallbackTimer = 0;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    frameWindow.removeEventListener("afterprint", cleanup);
    frame.remove();
    activePrints.delete(options.key);
    options.onAfterPrint?.();
  };
  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  fallbackTimer = window.setTimeout(cleanup, 60000);

  void (async () => {
    await frameDocument.fonts.ready;
    const images = Array.from(frameDocument.images);
    const ready = await Promise.all(images.map(imageReady));
    images.forEach((image, index) => {
      if (!ready[index]) showLogoFallback(image);
    });

    const contentHeightPx = frameDocument.documentElement.scrollHeight;
    const heightMm = Math.max(
      profile.minHeightMm,
      Math.ceil(contentHeightPx / 96 * 25.4 + profile.feedMm)
    );
    const pageStyle = frameDocument.createElement("style");
    pageStyle.textContent = `
      @page { size: ${profile.paperWidthMm}mm ${heightMm}mm; margin: 0; }
      html, body { width: ${profile.paperWidthMm}mm; margin: 0; padding: 0; height: auto; }
      .receipt { width: ${profile.paperWidthMm}mm; padding: ${profile.topPaddingMm}mm ${profile.sidePaddingMm}mm 0; }
      .receipt-feed { height: ${profile.feedMm}mm; }
    `;
    frameDocument.head.appendChild(pageStyle);
    frameWindow.focus();
    frameWindow.print();
  })().catch((error: unknown) => {
    cleanup();
    if (options.onError) options.onError(error);
    else console.error("Receipt printing failed:", error);
  });

  return true;
}

export function printPlainLines(
  title: string,
  lines: string[],
  paperSize = DEFAULT_RECEIPT_PAPER_SIZE,
  afterPrint?: () => void,
  onError?: (error: unknown) => void
) {
  const content = `<pre class="plain-lines">${escapeHtml(lines
    .flatMap((line) => wrapPrintText(line))
    .join("\n"))}</pre><div class="receipt-feed" aria-hidden="true"></div>`;
  return printReceiptDocument({
    key: `plain:${title}`,
    title,
    content,
    paperSize,
    onAfterPrint: afterPrint,
    onError
  });
}
