import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { Button } from "../../components/ui/button";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import "./Login.css";

type Step = "email" | "code" | "done";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Staff "Forgot password" and first-time account setup.
 * Supabase emails a one-time code; entering it with a new password saves the password.
 * ?setup=1 shows the account-setup wording; ?step=code&email=... opens the code form.
 */
export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const isSetup = searchParams.get("setup") === "1";
  // Links in the code email use ?step=code&email=..., so staff land on the code form directly.
  const [step, setStep] = useState<Step>(searchParams.get("step") === "code" && searchParams.get("email") ? "code" : "email");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (!validEmail(email)) {
      setMessage("Enter a valid email address.");
      return;
    }
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await api.post<{ message: string }>("/api/auth/password/forgot", { email: email.trim() });
      setNotice(response.data.message);
      setStep("code");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "We couldn't send the code. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6,10}$/.test(code.trim())) {
      setMessage("Enter the 6-digit code from the email.");
      return;
    }
    if (password.length < 8) {
      setMessage("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("The two passwords don't match.");
      return;
    }
    setMessage("");
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/password/reset", { email: email.trim(), code: code.trim(), password });
      setStep("done");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "We couldn't save your password. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = step === "done"
    ? (isSetup ? "Your account is ready" : "Password updated")
    : isSetup ? "Set up your account" : "Reset your password";
  const subtitle = step === "email"
    ? "Enter your work email and we'll send you a 6-digit code."
    : step === "code"
      ? `Enter the code we emailed to ${email.trim() || "you"}, then choose a new password.`
      : "You can now sign in with your new password.";

  return (
    <main className="staff-login-page">
      <section className="staff-login-brand" aria-label="Katana Sushi">
        <div className="staff-login-sun" aria-hidden="true" />
        <div className="staff-login-waves" aria-hidden="true" />
        <div className="staff-login-brand-inner">
          <div className="staff-login-brand-mark">
            <img src="/images/katana-logo.jpg" alt="Katana Sushi logo" width="52" height="52" />
            <div>
              <p className="staff-login-brand-name">Katana Sushi</p>
              <p className="staff-login-brand-subtitle">Team account</p>
            </div>
          </div>
          <div className="staff-login-brand-copy">
            <p className="staff-login-eyebrow">Account help</p>
            <h1>{isSetup ? "Welcome to the team." : "Back in a minute."}</h1>
            <p className="staff-login-description">
              We'll email a one-time code to confirm it's you. The code works once and expires after about an hour.
            </p>
          </div>
          <p className="staff-login-brand-footer">Thoughtful service, made together.</p>
        </div>
      </section>

      <section className="staff-login-content" aria-label={title}>
        <div className="staff-login-card">
          <div className="staff-login-card-heading">
            <span className="staff-login-card-kicker">{isSetup ? "New account" : "Forgot password"}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          {step === "email" && (
            <form onSubmit={requestCode} noValidate>
              <div className="staff-login-fields">
                <div className="staff-login-field">
                  <label htmlFor="reset-email">Email address</label>
                  <div className="staff-login-input-wrap">
                    <Mail aria-hidden="true" />
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@katanasushi.com"
                      value={email}
                      onChange={(event) => { setEmail(event.target.value); setMessage(""); }}
                    />
                  </div>
                </div>
              </div>
              {message && <p className="staff-login-server-message" role="alert">{message}</p>}
              <Button type="submit" className="staff-login-submit" size="md" disabled={isSubmitting}>
                {isSubmitting ? <><span className="staff-login-spinner" aria-hidden="true" /> Sending code…</> : <>Send code <ArrowRight aria-hidden="true" /></>}
              </Button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={savePassword} noValidate>
              {notice && <p className="staff-login-card-footer" role="status">{notice}</p>}
              <div className="staff-login-fields">
                <div className="staff-login-field">
                  <label htmlFor="reset-code">6-digit code</label>
                  <div className="staff-login-input-wrap">
                    <KeyRound aria-hidden="true" />
                    <input
                      id="reset-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={10}
                      value={code}
                      onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setMessage(""); }}
                    />
                  </div>
                </div>
                <div className="staff-login-field">
                  <label htmlFor="reset-password">New password</label>
                  <div className="staff-login-input-wrap">
                    <LockKeyhole aria-hidden="true" />
                    <input
                      id="reset-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(event) => { setPassword(event.target.value); setMessage(""); }}
                    />
                    <button
                      type="button"
                      className="staff-login-password-toggle"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div className="staff-login-field">
                  <label htmlFor="reset-password-confirm">Confirm new password</label>
                  <div className="staff-login-input-wrap">
                    <LockKeyhole aria-hidden="true" />
                    <input
                      id="reset-password-confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Type it again"
                      value={confirmPassword}
                      onChange={(event) => { setConfirmPassword(event.target.value); setMessage(""); }}
                    />
                  </div>
                </div>
              </div>
              {message && <p className="staff-login-server-message" role="alert">{message}</p>}
              <Button type="submit" className="staff-login-submit" size="md" disabled={isSubmitting}>
                {isSubmitting ? <><span className="staff-login-spinner" aria-hidden="true" /> Saving…</> : <>{isSetup ? "Set password" : "Save new password"} <ArrowRight aria-hidden="true" /></>}
              </Button>
              <div className="staff-login-options">
                <button type="button" className="staff-login-forgot" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>
                  Use a different email
                </button>
                <button type="button" className="staff-login-forgot" disabled={isSubmitting} onClick={() => void requestCode()}>
                  Send a new code
                </button>
              </div>
            </form>
          )}

          {step === "done" && (
            <div className="staff-login-fields">
              <p className="staff-login-card-footer" role="status">
                <CheckCircle2 aria-hidden="true" style={{ display: "inline", width: 18, height: 18, marginRight: 6, verticalAlign: "-3px" }} />
                {isSetup ? "Your password is set." : "Your password has been changed."}
              </p>
              <Link to="/staff/login" className="staff-login-submit" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none" }}>
                Go to sign in <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          )}

          {step !== "done" && (
            <Link to="/staff/login" className="staff-login-public-link" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <ArrowLeft aria-hidden="true" style={{ width: 16, height: 16 }} /> Back to sign in
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
