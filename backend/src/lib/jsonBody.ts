import express, { Request } from "express";

/** Paths whose exact request bytes must be kept for signature checks. */
const RAW_BODY_PATHS = ["/api/payments/paymongo/webhook"];

export type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * JSON body parser that also keeps the raw bytes for webhook routes, because
 * PayMongo signs the payload exactly as sent, not as re-serialized JSON.
 */
export function jsonBodyParser() {
  return express.json({
    verify: (req, _res, buffer) => {
      const url = (req as Request).originalUrl ?? req.url ?? "";
      if (RAW_BODY_PATHS.some((path) => url.startsWith(path))) {
        (req as RequestWithRawBody).rawBody = Buffer.from(buffer);
      }
    }
  });
}
