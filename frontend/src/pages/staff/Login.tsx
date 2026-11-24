import axios from "axios";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  CalendarCheck2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Monitor
} from "lucide-react";
import { Button } from "../../components/ui/button";
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
    return "/staff/catering";
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
  const [shake, setShake] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const navigate = useNavigate();

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
      navigate(defaultRouteForRole(response.data.user.role));
    } catch (error) {
      setMessage(loginErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      window.setTimeout(() => setShake(false), 450);
      return;
    }

    await loginWithCredentials(email, password);
  }

  return (
    <main className="staff-login-page">
      <section className="staff-login-brand" aria-label="Katana Sushi sign-in">
        <div className="staff-login-sun" aria-hidden="true" />
        <div className="staff-login-waves" aria-hidden="true" />
        <div className="staff-login-brand-inner">
          <div className="staff-login-brand-mark">
            {logoFailed ? (
              <span className="staff-login-logo-fallback" aria-hidden="true">K</span>
            ) : (
              <img
                src="/images/katana-logo.jpg"
                alt="Katana Sushi logo"
                width="52"
                height="52"
                onError={() => setLogoFailed(true)}
              />
            )}
            <div>
              <p className="staff-login-brand-name">Katana Sushi</p>
              <p className="staff-login-brand-subtitle">Team sign-in</p>
            </div>
          </div>

          <div className="staff-login-brand-copy">
            <p className="staff-login-eyebrow">One team. Every service.</p>
            <h1>Service starts here.</h1>
            <p className="staff-login-description">
              Your daily tools for keeping every Katana Sushi service running smoothly.
            </p>
            <ul className="staff-login-features">
              <li><CalendarCheck2 aria-hidden="true" /><span>Review and approve bookings</span></li>
              <li><Boxes aria-hidden="true" /><span>Keep stock and expiry in check</span></li>
              <li><Monitor aria-hidden="true" /><span>Run a seamless point of sale</span></li>
            </ul>
          </div>
          <p className="staff-login-brand-footer">Thoughtful service, made together.</p>
        </div>
      </section>

      <section className="staff-login-content" aria-label="Sign in">
        <div className={`staff-login-card${shake ? " staff-login-card-shake" : ""}`} data-testid="staff-login-card">
          <div className="staff-login-card-heading">
            <span className="staff-login-card-kicker">Welcome back</span>
            <h2>Sign in to your account</h2>
            <p>Use your account credentials to continue.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
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
                <input type="checkbox" />
                <span>Keep me signed in</span>
              </label>
              <Link
                to={`/staff/forgot-password${validEmail(email) ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
                className="staff-login-forgot"
              >
                Forgot password?
              </Link>
            </div>

            {message && <p className="staff-login-server-message" role="alert">{message}</p>}

            <Button
              type="submit"
              className="staff-login-submit"
              size="md"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="staff-login-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in now
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </form>

          <div className="staff-login-card-footer">
            <span>Need help?</span> Use "Forgot password?" to get a reset code by email, or ask your manager.
          </div>
        </div>
        <Link to="/" className="staff-login-public-link">Return to public site</Link>
      </section>
    </main>
  );
}
