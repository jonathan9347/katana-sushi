export function getBeverageStockMaterialName(productName: string): string {
  const normalizedName = productName.trim();
  return /^softdrinks(?: \(coke\/sprite\/royal\))?$/i.test(normalizedName)
    ? "Softdrinks"
    : normalizedName;
}
