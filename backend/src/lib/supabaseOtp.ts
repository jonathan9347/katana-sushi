const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OtpResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

function looksLikePlaceholder(value: string) {
  return /your-|replace-|xxxx/i.test(value);
}

/**
 * Sends and checks one-time email codes with Supabase Auth.
 * Katana keeps its own staff logins; Supabase only delivers the code and
 * confirms that the person entering it controls the email address.
 *
 * The Supabase "Magic Link" and "Confirm signup" email templates must show
 * {{ .Token }} so the email contains a 6-digit code instead of only a link.
 */
export class SupabaseEmailOtp {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(
    // SUPABASE_AUTH_URL/KEY let staff codes come from a different Supabase project than storage.
    url = process.env.SUPABASE_AUTH_URL?.trim() || process.env.SUPABASE_URL?.trim(),
    key = process.env.SUPABASE_AUTH_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)
  ) {
    let baseUrl: string | null = null;
    if (url && !looksLikePlaceholder(url)) {
      try {
        const parsed = new URL(url);
        baseUrl = parsed.protocol === "https:" ? parsed.origin : null;
      } catch {
        baseUrl = null;
      }
    }
    this.baseUrl = baseUrl;
    // Pasted keys sometimes carry line breaks or spaces; a Supabase key never contains whitespace.
    const cleanedKey = key?.replace(/\s+/g, "");
    this.apiKey = cleanedKey && !looksLikePlaceholder(cleanedKey) ? cleanedKey : null;
  }

  get isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /** Emails a one-time code. Creates the Supabase Auth user for the address if needed. */
  async sendCode(email: string): Promise<OtpResult> {
    return this.call("/auth/v1/otp", { email, create_user: true });
  }

  /** Checks a code. Succeeds only if Supabase confirms it for this exact email. */
  async verifyCode(email: string, code: string): Promise<OtpResult> {
    const result = await this.call("/auth/v1/verify", { type: "email", email, token: code }, true);
    if (!result.ok) {
      return result;
    }
    const verifiedEmail = (result as OtpResult & { body?: { user?: { email?: string } } }).body?.user?.email;
    if (!verifiedEmail || verifiedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return { ok: false, status: 400, reason: "The code was not issued for this email." };
    }
    return { ok: true };
  }

  private async call(path: string, payload: unknown, keepBody = false): Promise<OtpResult> {
    if (!this.baseUrl || !this.apiKey) {
      return { ok: false, status: 503, reason: "Supabase email codes are not configured." };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
          // Only legacy JWT keys (eyJ...) go in Authorization; new sb_publishable_/sb_secret_ keys are not JWTs.
          ...(this.apiKey.startsWith("eyJ") ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      return { ok: false, status: 503, reason: `Supabase could not be reached: ${error instanceof Error ? error.message : String(error)}` };
    }

    const body = await response.json().catch(() => null) as
      | { msg?: string; message?: string; error_description?: string; user?: { email?: string } }
      | null;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: body?.msg ?? body?.error_description ?? body?.message ?? `Supabase returned HTTP ${response.status}.`
      };
    }

    return keepBody ? ({ ok: true, body } as OtpResult) : { ok: true };
  }
}
