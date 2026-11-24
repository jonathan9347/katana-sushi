import { formatCurrencyPHP } from "./reservationDetails";

type PackageSnapshot = {
  stationType?: unknown;
  packageName?: unknown;
  description?: unknown;
  unit?: unknown;
  quantity?: unknown;
  rate?: unknown;
  fixedPax?: unknown;
  minPax?: unknown;
  maxPax?: unknown;
  price?: unknown;
};

function isPackageSnapshot(value: unknown): value is PackageSnapshot {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stationLabel(stationType: string) {
  const labels: Record<string, string> = {
    sushi_station: "Sushi Station",
    whole_tuna: "Whole Tuna",
    tuna_add_on: "Tuna Add-on",
    salmon_add_on: "Salmon Add-on",
    tempura_live: "Tempura"
  };
  return labels[stationType] ?? stationType.split(/[_\s-]+/).map((part) =>
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  ).join(" ");
}

export function formatCateringPackageSnapshots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isPackageSnapshot).map((snapshot) => {
    const stationType = typeof snapshot.stationType === "string" ? snapshot.stationType : "";
    const station = stationLabel(stationType);
    const option = stationType === "tempura_live" && typeof snapshot.description === "string"
      ? snapshot.description
      : typeof snapshot.packageName === "string" ? snapshot.packageName : station;
    const price = typeof snapshot.price === "number" ? formatCurrencyPHP(snapshot.price) : "Price unavailable";

    if (
      ["whole_tuna", "tuna_add_on", "salmon_add_on"].includes(stationType) &&
      typeof snapshot.quantity === "number"
    ) {
      const unit = typeof snapshot.unit === "string" ? snapshot.unit : "kg";
      const rate = typeof snapshot.rate === "number"
        ? ` · ${formatCurrencyPHP(snapshot.rate)}/${unit}`
        : "";
      return `${station} — ${option} - ${snapshot.quantity} ${unit}${rate} - ${price}`;
    }

    if (stationType === "tempura_live") {
      const pax = typeof snapshot.fixedPax === "number" ? snapshot.fixedPax : snapshot.quantity;
      return `${station} — ${option}${typeof pax === "number" ? ` - ${pax} pax` : ""} - ${price}`;
    }

    if (typeof snapshot.quantity === "number" && snapshot.unit === "pax") {
      return `${station} — ${option} - ${snapshot.quantity} pax - ${price}`;
    }

    if (typeof snapshot.minPax === "number" && typeof snapshot.maxPax === "number") {
      return `${station} — ${option} - ${snapshot.minPax}-${snapshot.maxPax} pax - ${price}`;
    }

    return `${station} — ${option} - ${price}`;
  });
}
