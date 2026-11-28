import { formatManilaDate, formatManilaDateTime, manilaDateKey } from "./dateTime";

type ActivityRecord = {
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  message: string;
};

export type ActivityLookups = {
  products?: Record<string, string>;
  materials?: Record<string, string>;
  users?: Record<string, string>;
  reservations?: Record<string, string>;
};

export type ActivityDescription = {
  sentence: string;
  actor: string;
  phrase: string;
  target: string;
  category: string;
  icon: "book" | "box" | "clipboard" | "calendar" | "package" | "user" | "settings" | "activity";
  tone: "recipe" | "product" | "order" | "reservation" | "inventory" | "account" | "settings" | "neutral";
  hidden: boolean;
  dayKey: string;
};

const machineIdPattern = /^(?:c[a-z0-9]{20,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const humanOrderReferencePattern = /^(?:CAT-[A-Z0-9-]+|KTO-\d{8}-\d+)$/i;

export function humanizeEnum(value: string | null | undefined) {
  if (!value) return "Not available";
  const raw = value.trim().toLowerCase();
  const normalized = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized || machineIdPattern.test(raw)) return "Not available";
  const knownLabels: Record<string, string> = {
    downpayment: "Down payment",
    staff_activity: "Activity",
    "staff activity": "Activity",
    authentication: "Sign-in",
    undefined: "Not available",
    null: "Not available",
    nan: "Not available"
  };
  if (knownLabels[raw]) return knownLabels[raw];
  const normalizedLabels: Record<string, string> = {
    undefined: "Not available",
    null: "Not available",
    nan: "Not available"
  };
  if (normalizedLabels[normalized]) return normalizedLabels[normalized];
  if (normalized === "staff") return "Team member";
  return normalized.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Date unavailable";
  const formatted = formatManilaDateTime(value, { month: "long" });
  return formatted === "Invalid date" ? "Date unavailable" : formatted.replace(/, (\d{1,2}:)/, " at $1");
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Date unavailable";
  const formatted = formatManilaDate(value, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return formatted === "Invalid date" ? "Date unavailable" : formatted;
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "Time unavailable";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export function shortRef(value: string | null | undefined) {
  if (!value) return "—";
  const trimmed = value.trim();
  if (machineIdPattern.test(trimmed)) return "Reference unavailable";
  if (humanOrderReferencePattern.test(trimmed)) return trimmed;
  if (trimmed.length > 24 || /^(?:FAKE|TXN|REF)_/i.test(trimmed)) {
    return `Ref …${trimmed.slice(-3)}`;
  }
  return trimmed;
}

function isMachineId(value: string) {
  return machineIdPattern.test(value);
}

function describeReference(value: string | undefined, generic: string, lookup?: Record<string, string>) {
  if (!value) return generic;
  if (lookup?.[value]) return lookup[value];
  if (isMachineId(value)) return generic;
  return shortRef(value);
}

function activityVerb(method: string) {
  if (method === "POST") return "created";
  if (method === "DELETE") return "removed";
  if (method === "PUT" || method === "PATCH") return "updated";
  return "viewed";
}

export function describeActivity(entry: ActivityRecord, lookups: ActivityLookups = {}): ActivityDescription {
  const messageMatch = entry.message.match(/^(.*?)\s+completed\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+?)\.?$/i);
  const routeMatch = entry.message.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
  const method = (messageMatch?.[2] ?? routeMatch?.[1] ?? "").toUpperCase();
  const rawRoute = messageMatch?.[3] ?? routeMatch?.[2] ?? "";
  const route = rawRoute.replace(/[.,;]+$/, "").split("?")[0];
  const actor = entry.actor_name && !isMachineId(entry.actor_name)
    ? entry.actor_name
    : messageMatch?.[1]?.trim() || "System";
  const entity = entry.entity.toUpperCase();
  const action = entry.action.toLowerCase();
  const segments = route.split("/").filter(Boolean);
  const getIdAfter = (segment: string) => {
    const index = segments.indexOf(segment);
    return index >= 0 ? segments[index + 1] : undefined;
  };
  const isAuthentication = entity === "AUTHENTICATION" || /sign.?in|sign.?out|login|logout/.test(action);

  let category = "Activity";
  let tone: ActivityDescription["tone"] = "neutral";
  let icon: ActivityDescription["icon"] = "activity";
  let phrase = `${activityVerb(method)} a record`;
  let target = "";
  let hidden = method === "GET";

  if (isAuthentication) {
    category = "Sign-in";
    phrase = /logout|sign.?out/i.test(action) || /logout|sign.?out/i.test(entry.message) ? "signed out" : "signed in";
    hidden = false;
    tone = "neutral";
    icon = "user";
  } else if (route.includes("/products")) {
    category = route.includes("/recipe") ? "Recipe" : "Product";
    tone = category === "Recipe" ? "recipe" : "product";
    icon = category === "Recipe" ? "book" : "box";
    const productId = getIdAfter("products");
    target = describeReference(productId, "a product", lookups.products);
    const hasProductTarget = target !== "a product";
    if (route.includes("/recipe") && method === "POST") {
      phrase = "saved the recipe for";
    } else if (!productId && method === "POST") {
      phrase = "added a product";
      target = "";
    } else if (method === "DELETE") {
      phrase = hasProductTarget ? "removed" : "removed a product";
      if (!hasProductTarget) target = "";
    } else if (method === "PUT" || method === "PATCH") {
      phrase = hasProductTarget ? "updated the product details for" : "updated a product";
      if (!hasProductTarget) target = "";
    } else {
      phrase = hasProductTarget ? "created a product called" : `${activityVerb(method)} a product`;
      if (!hasProductTarget) target = "";
    }
  } else if (route.includes("/takeout/orders")) {
    category = "Order";
    tone = "order";
    icon = "package";
    target = describeReference(getIdAfter("orders"), "an order");
    const hasOrderTarget = target !== "an order";
    phrase = route.endsWith("/status")
      ? hasOrderTarget ? "updated the status of pickup order" : "updated a pickup order"
      : hasOrderTarget ? `${activityVerb(method)} pickup order` : `${activityVerb(method)} a pickup order`;
    if (!hasOrderTarget) target = "";
  } else if (/reservations|catering/.test(route)) {
    category = "Reservation";
    tone = "reservation";
    icon = "calendar";
    const reservationId = getIdAfter("reservations") ?? getIdAfter("catering");
    target = describeReference(reservationId, "a reservation", lookups.reservations);
    const hasReservationTarget = target !== "a reservation";
    if (/approve/.test(route) || /approve/.test(action)) {
      phrase = hasReservationTarget ? "approved reservation" : "approved a reservation";
    } else if (/decline|reject/.test(route) || /decline|reject/.test(action)) {
      phrase = hasReservationTarget ? "declined reservation" : "declined a reservation";
    } else if (method === "DELETE" || /cancel/.test(route)) {
      phrase = hasReservationTarget ? "cancelled reservation" : "cancelled a reservation";
    } else {
      phrase = hasReservationTarget ? `${activityVerb(method)} reservation` : `${activityVerb(method)} a reservation`;
    }
  } else if (/inventory|materials|batches|waste|stock/.test(route)) {
    category = "Inventory";
    tone = "inventory";
    icon = "box";
    const materialId = getIdAfter("materials") ?? getIdAfter("raw-materials");
    target = describeReference(materialId, "a material", lookups.materials);
    if (route.includes("waste")) {
      phrase = target === "a material" ? "recorded inventory waste" : "recorded waste for";
      if (target === "a material") target = "";
    } else {
      phrase = `${activityVerb(method)} inventory`;
      target = "";
    }
  } else if (/users/.test(route)) {
    category = "Account";
    tone = "account";
    icon = "user";
    target = describeReference(getIdAfter("users"), "a user", lookups.users);
    const hasUserTarget = target !== "a user";
    if (/reset-password|password/.test(route)) {
      phrase = hasUserTarget ? "reset the password for" : "reset a user's password";
      if (!hasUserTarget) target = "";
    } else {
      phrase = method === "POST"
        ? hasUserTarget ? "added" : "added a user"
        : method === "DELETE"
          ? hasUserTarget ? "removed" : "removed a user"
          : hasUserTarget ? "updated" : "updated a user";
      if (!hasUserTarget) target = "";
    }
  } else if (/settings/.test(route)) {
    category = "Settings";
    tone = "settings";
    icon = "settings";
    phrase = `${activityVerb(method)} the settings`;
  }

  if (hidden) {
    phrase = "viewed a record";
    target = "";
  }
  if (!route && !isAuthentication) {
    category = "Activity";
    tone = "neutral";
    icon = "activity";
    phrase = "updated a record";
    target = "";
  }

  const sentence = [actor, phrase, target].filter(Boolean).join(" ");
  return {
    sentence,
    actor,
    phrase,
    target,
    category,
    icon,
    tone,
    hidden,
    dayKey: manilaDateKey(entry.created_at)
  };
}
