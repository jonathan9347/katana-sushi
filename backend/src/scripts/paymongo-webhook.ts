/**
 * Lists, registers, or updates the PayMongo webhook that confirms payments.
 *
 *   npm run paymongo:webhook -- list
 *   npm run paymongo:webhook -- create https://<your-api-host>/api/payments/paymongo/webhook
 *   npm run paymongo:webhook -- update <hook_id> https://<your-api-host>/api/payments/paymongo/webhook
 *
 * `create` prints the webhook secret (whsk_...). Put it in PAYMONGO_WEBHOOK_SECRET
 * on the server. PayMongo only calls public HTTPS URLs, so use the deployed API.
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// payment.paid / payment.failed: Katana's payment page (Payment Intents).
// checkout_session.payment.paid: payments started on the older PayMongo checkout page.
const WEBHOOK_EVENTS = ["payment.paid", "payment.failed", "checkout_session.payment.paid"];

type WebhookRecord = {
  id: string;
  attributes: { url: string; status: string; events: string[]; livemode: boolean; secret_key?: string };
};

async function paymongo<T>(method: "GET" | "POST" | "PUT", pathName: string, body?: unknown): Promise<T> {
  const secretKey = process.env.PAYMONGO_SECRET_KEY?.trim();
  if (!secretKey?.startsWith("sk_")) {
    throw new Error("Set PAYMONGO_SECRET_KEY (sk_test_... or sk_live_...) in backend/.env first.");
  }

  const response = await fetch(`https://api.paymongo.com/v1${pathName}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null) as { errors?: Array<{ detail?: string }> } | null;
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail ?? `PayMongo returned HTTP ${response.status}.`);
  }
  return payload as T;
}

async function list() {
  const result = await paymongo<{ data: WebhookRecord[] }>("GET", "/webhooks");
  if (result.data.length === 0) {
    console.log("No webhooks registered.");
    return;
  }
  for (const webhook of result.data) {
    const mode = webhook.attributes.livemode ? "live" : "test";
    console.log(`${webhook.id}  ${webhook.attributes.status}  ${mode}  ${webhook.attributes.url}  [${webhook.attributes.events.join(", ")}]`);
  }
}

async function create(url: string | undefined) {
  if (!url || !/^https:\/\/.+\/api\/payments\/paymongo\/webhook$/.test(url)) {
    throw new Error("Pass the public HTTPS URL ending in /api/payments/paymongo/webhook.");
  }
  const result = await paymongo<{ data: WebhookRecord }>("POST", "/webhooks", {
    data: { attributes: { url, events: WEBHOOK_EVENTS } }
  });
  console.log(`Registered ${result.data.id} for ${result.data.attributes.url}`);
  console.log(`Set this on the server as PAYMONGO_WEBHOOK_SECRET: ${result.data.attributes.secret_key}`);
}

/** Keeps the webhook's secret; only its URL and events change. */
async function update(id: string | undefined, url: string | undefined) {
  if (!id || !/^hook_[A-Za-z0-9]+$/.test(id)) {
    throw new Error("Pass the webhook id (hook_...) shown by `list`.");
  }
  if (!url || !/^https:\/\/.+\/api\/payments\/paymongo\/webhook$/.test(url)) {
    throw new Error("Pass the public HTTPS URL ending in /api/payments/paymongo/webhook.");
  }
  const result = await paymongo<{ data: WebhookRecord }>("PUT", `/webhooks/${id}`, {
    data: { attributes: { url, events: WEBHOOK_EVENTS } }
  });
  console.log(`Updated ${result.data.id}: ${result.data.attributes.status}, events [${result.data.attributes.events.join(", ")}]`);
}

const [command, firstArgument, secondArgument] = process.argv.slice(2);
(command === "create"
  ? create(firstArgument)
  : command === "update"
    ? update(firstArgument, secondArgument)
    : command === "list"
      ? list()
      : Promise.reject(new Error("Usage: list | create <url> | update <hook_id> <url>")))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
