export const PRINT_LINE_WIDTH = 32;
export const PRINTABLE_WIDTH_MM = 48;

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

export function printPlainLines(
  target: Window,
  title: string,
  lines: string[],
  paperSize: string,
  afterPrint?: () => void
) {
  const selectedPaperSize = paperSize || "58mm";
  const pageSettings = {
    "58mm": { size: "58mm auto", width: "58mm" },
    "80mm": { size: "80mm auto", width: "80mm" },
    A4: { size: "A4 portrait", width: "100%" }
  }[selectedPaperSize];
  if (!pageSettings) {
    throw new Error(`Unsupported receipt paper size: ${selectedPaperSize}`);
  }
  const content = lines
    .flatMap((line) => wrapPrintText(line))
    .join("\n");
  target.document.open();
  target.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(plainText(title))}</title>
        <style>
          @page { size: ${pageSettings.size}; margin: 0; }
          html, body { width: ${pageSettings.width}; margin: 0; padding: 0; }
          body { color: #000; background: #fff; font: 7pt/1.2 "Courier New", monospace; }
          pre { box-sizing: border-box; width: 32ch; max-width: ${PRINTABLE_WIDTH_MM}mm; margin: 0 auto; padding: 0; white-space: pre; overflow-wrap: normal; }
          @media print { html, body { margin: 0 !important; padding: 0 !important; } }
        </style>
      </head>
      <body><pre data-testid="print-lines">${escapeHtml(content)}</pre></body>
    </html>`);
  target.document.close();
  if (afterPrint) target.onafterprint = afterPrint;
  target.focus();
  target.print();
}
