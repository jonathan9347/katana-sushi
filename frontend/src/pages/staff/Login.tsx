import axios from "axios";
import { FormEvent, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  AlertCircle,
  Boxes,
  CalendarCheck2,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Monitor
} from "lucide-react";
import { api } from "../../lib/api";
import "./Login.css";

type LoginFieldErrors = {
  email?: string;
  password?: string;
};

function loginErrorMessage(error: unknown) {
  if (axios.isAxiosError<{ message?: unknown }>(error)) {
    if (error.response?.status === 401) {
      return "Invalid email or password. Please try again.";
    }

    const responseMessage = error.response?.data?.message;
    if (typeof responseMessage === "string" && responseMessage.trim()) {
      return responseMessage;
    }

    if (!error.response) {
      return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT"
        ? "The sign-in request timed out. Please try again."
        : "Unable to reach the sign-in server. Check your connection and try again.";
    }
  }

  return "Unable to sign in. Please try again.";
}

function defaultRouteForRole(role: string) {
  const normalized = role.toLowerCase();

  if (normalized === "admin") {
    return "/staff/dashboard";
  }
  if (normalized === "inventory_manager") {
    return "/staff/inventory";
  }
  if (normalized === "cashier") {
    return "/staff/pos";
  }
  if (normalized === "receptionist") {
    return "/staff/reservations";
  }
  if (normalized === "event_coordinator") {
    return "/staff/reservations?view=catering";
  }
  if (normalized === "chef") {
    return "/staff/inventory/read-only";
  }

  return "/staff/dashboard";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [shake, setShake] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [authStage, setAuthStage] = useState<"signing-in" | "welcome-back" | null>(null);
  const [authOrigin, setAuthOrigin] = useState<{ x: number; y: number } | null>(null);
  const [authOverlayClosing, setAuthOverlayClosing] = useState(false);
  const [motionPaused, setMotionPaused] = useState(() => document.visibilityState === "hidden");
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function updateVisibility() {
      setMotionPaused(document.visibilityState === "hidden");
    }

    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  async function loginWithCredentials(emailValue: string, passwordValue: string) {
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await api.post<{ token: string; user: { id: string; email: string; role: string; name: string } }>(
        "/api/auth/login",
        { email: emailValue, password: passwordValue }
      );

      localStorage.setItem("katana_token", response.data.token);
      localStorage.setItem("katana_role", response.data.user.role.toLowerCase());
      localStorage.setItem("katana_user", JSON.stringify(response.data.user));
      return defaultRouteForRole(response.data.user.role);
    } catch (error) {
      setMessage(loginErrorMessage(error));
      return null;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const nextErrors: LoginFieldErrors = {};

    if (!validEmail(email)) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!password.trim()) {
      nextErrors.password = "Enter your password.";
    }

    setFieldErrors(nextErrors);
    setMessage("");

    if (Object.keys(nextErrors).length > 0) {
      setShake(true);
      window.setTimeout(() => setShake(false), 300);
      return;
    }

    const buttonRect = submitButtonRef.current?.getBoundingClientRect();
    const animationStartedAt = Date.now();
    setAuthOrigin(buttonRect
      ? { x: buttonRect.left + buttonRect.width / 2, y: buttonRect.top + buttonRect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setAuthStage("signing-in");
    const destination = await loginWithCredentials(email, password);

    if (!destination) {
      setIsSubmitting(false);
      setShake(true);
      window.setTimeout(() => setShake(false), 300);
      setAuthOverlayClosing(true);
      window.setTimeout(() => {
        setAuthStage(null);
        setAuthOverlayClosing(false);
      }, 200);
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, 1200 - (Date.now() - animationStartedAt))));
    setAuthStage("welcome-back");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => navigate(destination), reducedMotion ? 150 : 1200);
  }

  return (
    <main className={`staff-login-page${motionPaused ? " staff-login-motion-paused" : ""}`}>
      <section className="staff-login-brand" aria-label="Katana Sushi team sign-in">
        <div className="staff-login-glow staff-login-glow-top" aria-hidden="true" />
        <div className="staff-login-glow staff-login-glow-bottom" aria-hidden="true" />
        <svg className="staff-login-waves" width="100%" height="100%" aria-hidden="true">
          <defs>
            <pattern id="staff-login-seigaiha" width="48" height="24" patternUnits="userSpaceOnUse">
              <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="48 0" dur="10s" repeatCount="indefinite" />
              <path d="M-24 24a24 24 0 0 1 48 0M0 24a24 24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0" fill="none" stroke="white" strokeOpacity=".12" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#staff-login-seigaiha)" />
        </svg>
        <SushiRoll className="staff-login-floating-roll staff-login-floating-roll-one" />
        <SushiRoll className="staff-login-floating-roll staff-login-floating-roll-two" />
        <SushiRoll className="staff-login-floating-roll staff-login-floating-roll-three" />
        <div className="staff-login-brand-inner">
          <div className="staff-login-brand-mark">
            {logoFailed ? (
              <span className="staff-login-logo-fallback" aria-hidden="true">K</span>
            ) : (
              <img
                src="/images/katana-logo.jpg"
                alt=""
                width="64"
                height="64"
                onError={() => setLogoFailed(true)}
              />
            )}
            <div>
              <p className="staff-login-brand-name">Katana Sushi</p>
              <p className="staff-login-brand-subtitle">Team sign-in</p>
            </div>
          </div>

          <div className="staff-login-brand-copy">
            <p className="staff-login-eyebrow"><span className="staff-login-live-dot" aria-hidden="true" />ONE TEAM. EVERY SERVICE.</p>
            <h1 className="staff-login-typing-heading" aria-label="Service starts here.">
              <span className="staff-login-typing-phrase staff-login-phrase-one" aria-hidden="true">Service starts here.</span>
              <span className="staff-login-typing-phrase staff-login-phrase-two" aria-hidden="true">Bookings approved.</span>
              <span className="staff-login-typing-phrase staff-login-phrase-three" aria-hidden="true">Stock always in check.</span>
              <span className="staff-login-typing-phrase staff-login-phrase-four" aria-hidden="true">Every sale, seamless.</span>
            </h1>
            <p className="staff-login-description">
              Your daily tools for keeping every Katana Sushi service running smoothly.
            </p>
            <ul className="staff-login-features" aria-hidden="true">
              <li className="staff-login-feature-one"><CalendarCheck2 aria-hidden="true" /><span>Review and approve bookings</span></li>
              <li className="staff-login-feature-two"><Boxes aria-hidden="true" /><span>Keep stock and expiry in check</span></li>
              <li className="staff-login-feature-three"><Monitor aria-hidden="true" /><span>Run a seamless point of sale</span></li>
            </ul>
          </div>
          <p className="staff-login-brand-footer">Thoughtful service, made together.</p>
        </div>
        <div className="staff-login-notices" aria-hidden="true">
          <div className="staff-login-notice staff-login-notice-two"><span><Check /></span><strong>Booking approved</strong></div>
          <div className="staff-login-notice staff-login-notice-three"><span><Check /></span><strong>Stock count updated</strong></div>
          <div className="staff-login-notice staff-login-notice-four"><span><Check /></span><strong>Order completed</strong></div>
        </div>
      </section>

      <section className="staff-login-content" aria-label="Sign in">
        <div className={`staff-login-card${shake ? " staff-login-card-shake" : ""}`} data-testid="staff-login-card">
          <div className="staff-login-card-heading">
            <span className="staff-login-card-kicker">WELCOME BACK</span>
            <h2>Sign in to your account</h2>
            <p>Use your account credentials to continue.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {message && (
              <p className="staff-login-server-message" role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{message}</span>
              </p>
            )}
            <div className="staff-login-fields">
              <div className="staff-login-field">
                <label htmlFor="staff-login-email">Email address</label>
                <div className={`staff-login-input-wrap${fieldErrors.email ? " has-error" : ""}`}>
                  <Mail aria-hidden="true" />
                  <input
                    id="staff-login-email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@katanasushi.com"
                    value={email}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "staff-login-email-error" : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setFieldErrors((current) => ({ ...current, email: undefined }));
                      setMessage("");
                    }}
                  />
                </div>
                {fieldErrors.email && <p className="staff-login-field-error" id="staff-login-email-error">{fieldErrors.email}</p>}
              </div>

              <div className="staff-login-field">
                <label htmlFor="staff-login-password">Password</label>
                <div className={`staff-login-input-wrap${fieldErrors.password ? " has-error" : ""}`}>
                  <LockKeyhole aria-hidden="true" />
                  <input
                    id="staff-login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "staff-login-password-error" : undefined}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setFieldErrors((current) => ({ ...current, password: undefined }));
                      setMessage("");
                    }}
                  />
                  <button
                    type="button"
                    className="staff-login-password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
                {fieldErrors.password && <p className="staff-login-field-error" id="staff-login-password-error">{fieldErrors.password}</p>}
              </div>
            </div>

            <div className="staff-login-options">
              <label className="staff-login-remember">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <span className="staff-login-checkbox" aria-hidden="true"><Check /></span>
                <span>Keep me signed in</span>
              </label>
              <button
                type="button"
                className="staff-login-forgot"
                onClick={() => setMessage("Contact your manager to reset your login access.")}
              >
                Forgot password?
              </button>
            </div>

            <button
              ref={submitButtonRef}
              type="submit"
              className="staff-login-submit"
              disabled={isSubmitting}
            >
              <span>Sign in now</span>
              <ArrowRight aria-hidden="true" />
            </button>
          </form>

          <div className="staff-login-card-footer">
            <span>Need help?</span> Contact your manager to reset your login access.
          </div>
        </div>
        <Link to="/" className="staff-login-public-link">Return to public site</Link>
      </section>
      {authStage && (
        <AuthOverlay
          stage={authStage}
          origin={authOrigin}
          closing={authOverlayClosing}
          reducedMotion={window.matchMedia("(prefers-reduced-motion: reduce)").matches}
        />
      )}
    </main>
  );
}

function SushiRoll({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 52 52" aria-hidden="true" focusable="false">
      <circle cx="26" cy="26" r="23" fill="#fff" />
      <circle cx="26" cy="26" r="17" fill="#17191e" />
      <circle cx="26" cy="26" r="12" fill="#f3ece0" />
      <circle cx="21" cy="22" r="4" fill="#e0575c" />
      <circle cx="30" cy="29" r="4" fill="#68a66c" />
      <circle cx="30" cy="20" r="2.5" fill="#f4c55f" />
    </svg>
  );
}

function AuthOverlay({
  stage,
  origin,
  closing,
  reducedMotion
}: {
  stage: "signing-in" | "welcome-back";
  origin: { x: number; y: number } | null;
  closing: boolean;
  reducedMotion: boolean;
}) {
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;

  return (
    <div
      className={`staff-login-auth-overlay${stage === "welcome-back" ? " is-welcome-back" : ""}${closing ? " is-closing" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
      role="status"
      aria-live="polite"
      style={{ "--auth-origin-x": `${x}px`, "--auth-origin-y": `${y}px` } as CSSProperties}
    >
      <svg className="staff-login-auth-waves" width="100%" height="100%" aria-hidden="true">
        <defs>
          <pattern id="staff-login-auth-pattern" width="48" height="24" patternUnits="userSpaceOnUse">
            <path d="M-24 24a24 24 0 0 1 48 0M0 24a24 24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0" fill="none" stroke="white" strokeOpacity=".12" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#staff-login-auth-pattern)" />
      </svg>
      <span className="staff-login-auth-circle" aria-hidden="true" />
      <section className={`staff-login-auth-scene staff-login-auth-signing${stage === "welcome-back" ? " is-exiting" : ""}`} aria-label="Signing you in">
        <div className="staff-login-auth-badge" aria-hidden="true">
          <img src="/images/katana-logo.jpg" alt="" />
        </div>
        <h2>Signing you in<span aria-hidden="true">...</span></h2>
        <p>Checking your credentials and preparing your workspace</p>
        <div className="staff-login-auth-progress" aria-hidden="true">
          <span />
          <SushiRoll className="staff-login-auth-roll" />
        </div>
      </section>
      {stage === "welcome-back" && (
        <section className="staff-login-auth-scene staff-login-auth-success" aria-labelledby="staff-login-welcome-title">
          <div className="staff-login-auth-check" aria-hidden="true">
            <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="m15 27 7 7 15-16" /></svg>
          </div>
          <div className="staff-login-auth-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          <h2 id="staff-login-welcome-title">Welcome back</h2>
          <p>Taking you to your dashboard…</p>
        </section>
      )}
    </div>
  );
}
