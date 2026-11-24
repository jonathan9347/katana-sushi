import bcrypt from "bcrypt";
import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { SupabaseEmailOtp } from "../lib/supabaseOtp";
import { createPasswordResetAuditLog } from "../lib/userPasswordResetAudit";

const RESEND_COOLDOWN_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const SENT_MESSAGE = "If that email belongs to a staff account, we sent a 6-digit code to it. It expires in about an hour.";
const INVALID_CODE_MESSAGE = "That code is invalid or has expired. Check the latest email or request a new code.";

type StaffAccount = { id: string; name: string; is_active: boolean };

export type StaffPasswordStore = {
  findByEmail(email: string): Promise<StaffAccount | null>;
  savePassword(user: StaffAccount, passwordHash: string): Promise<void>;
};

const prismaStore: StaffPasswordStore = {
  findByEmail: (email) =>
    prisma.user.findUnique({ where: { email }, select: { id: true, name: true, is_active: true } }),
  async savePassword(user, passwordHash) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } }),
      prisma.auditLog.create({ data: createPasswordResetAuditLog(user.id, user.id, user.name) })
    ]);
  }
};

type StaffPasswordOptions = {
  otp?: SupabaseEmailOtp;
  store?: StaffPasswordStore;
  now?: () => number;
};

/** Sends a setup or reset code to an active staff account. Used by admin user creation too. */
export async function sendStaffSetupCode(email: string, otp = new SupabaseEmailOtp()) {
  return otp.sendCode(email.trim().toLowerCase());
}

/**
 * Staff "Forgot password" and first-time account setup.
 * 1. POST /auth/password/forgot  { email }                 -> Supabase emails a code
 * 2. POST /auth/password/reset   { email, code, password } -> code checked, password saved
 */
export function createStaffPasswordRouter(options: StaffPasswordOptions = {}) {
  const router = express.Router();
  const otp = options.otp ?? new SupabaseEmailOtp();
  const store = options.store ?? prismaStore;
  const now = options.now ?? (() => Date.now());
  const lastSentAt = new Map<string, number>();
  const failures = new Map<string, { count: number; firstAt: number }>();

  function isLockedOut(email: string) {
    const entry = failures.get(email);
    if (!entry) return false;
    if (now() - entry.firstAt > FAILURE_WINDOW_MS) {
      failures.delete(email);
      return false;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS;
  }

  function recordFailure(email: string) {
    const entry = failures.get(email);
    if (!entry || now() - entry.firstAt > FAILURE_WINDOW_MS) {
      failures.set(email, { count: 1, firstAt: now() });
    } else {
      entry.count += 1;
    }
  }

  router.post("/auth/password/forgot", async (req, res, next) => {
    try {
      const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(req.body);
      const normalized = email.toLowerCase();

      if (!otp.isConfigured) {
        return res.status(503).json({ message: "Password reset by email isn't set up yet. Ask an admin to reset your password." });
      }

      const previous = lastSentAt.get(normalized);
      if (previous && now() - previous < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ message: "Please wait a minute before requesting another code." });
      }

      const user = await store.findByEmail(normalized);
      if (user?.is_active) {
        const result = await otp.sendCode(normalized);
        if (!result.ok) {
          console.error(`[StaffPassword] Could not send a code: ${result.reason}`);
          if (result.status === 429) {
            return res.status(429).json({ message: "Too many codes were requested. Please wait a few minutes and try again." });
          }
          return res.status(502).json({ message: "We couldn't send the code right now. Please try again in a minute." });
        }
        lastSentAt.set(normalized, now());
      }

      // Same answer whether or not the account exists, so emails can't be probed.
      return res.json({ message: SENT_MESSAGE });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Enter a valid email address." });
      }
      return next(error);
    }
  });

  router.post("/auth/password/reset", async (req, res, next) => {
    try {
      const body = z.object({
        email: z.string().trim().email().max(254),
        code: z.string().trim().regex(/^\d{6,10}$/, "Enter the code from the email."),
        password: z.string().min(8, "Use at least 8 characters.").max(128)
      }).parse(req.body);
      const normalized = body.email.toLowerCase();

      if (!otp.isConfigured) {
        return res.status(503).json({ message: "Password reset by email isn't set up yet. Ask an admin to reset your password." });
      }
      if (isLockedOut(normalized)) {
        return res.status(429).json({ message: "Too many incorrect codes. Request a new code in 15 minutes." });
      }

      const user = await store.findByEmail(normalized);
      if (!user?.is_active) {
        recordFailure(normalized);
        return res.status(400).json({ message: INVALID_CODE_MESSAGE });
      }

      const verified = await otp.verifyCode(normalized, body.code);
      if (!verified.ok) {
        if (verified.status >= 500) {
          console.error(`[StaffPassword] Could not check a code: ${verified.reason}`);
          return res.status(502).json({ message: "We couldn't check the code right now. Please try again in a minute." });
        }
        recordFailure(normalized);
        return res.status(400).json({ message: INVALID_CODE_MESSAGE });
      }

      await store.savePassword(user, await bcrypt.hash(body.password, 10));
      failures.delete(normalized);
      lastSentAt.delete(normalized);

      return res.json({ message: "Your password is set. You can sign in now." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message ?? "Check the form and try again." });
      }
      return next(error);
    }
  });

  return router;
}

export default createStaffPasswordRouter();
