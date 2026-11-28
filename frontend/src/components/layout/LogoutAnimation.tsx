import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./LogoutAnimation.css";

export const LOGOUT_ANIMATION_START = "katana-logout-animation-start";
export const LOGOUT_ANIMATION_COMPLETE = "katana-logout-animation-complete";

type LogoutOrigin = {
  x: number;
  y: number;
};

type LogoutSession = {
  name: string;
  origin: LogoutOrigin;
  startedAt: number;
  complete: boolean;
  signedOut: boolean;
};

export function LogoutAnimation() {
  const [session, setSession] = useState<LogoutSession | null>(null);
  const navigate = useNavigate();
  const signInButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ name: string; origin: LogoutOrigin }>).detail;
      setSession({
        name: detail?.name || "there",
        origin: detail?.origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        startedAt: Date.now(),
        complete: false,
        signedOut: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      });
    }

    function onComplete() {
      setSession((current) => current ? { ...current, complete: true } : current);
    }

    window.addEventListener(LOGOUT_ANIMATION_START, onStart);
    window.addEventListener(LOGOUT_ANIMATION_COMPLETE, onComplete);
    return () => {
      window.removeEventListener(LOGOUT_ANIMATION_START, onStart);
      window.removeEventListener(LOGOUT_ANIMATION_COMPLETE, onComplete);
    };
  }, []);

  useEffect(() => {
    if (!session || session.signedOut || !session.complete) return;
    const remaining = Math.max(0, 2800 - (Date.now() - session.startedAt));
    const timer = window.setTimeout(() => {
      setSession((current) => current ? { ...current, signedOut: true } : current);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (!session?.signedOut || !session.complete) return;
    const frame = window.requestAnimationFrame(() => signInButtonRef.current?.focus());
    const timer = window.setTimeout(() => {
      setSession(null);
      navigate("/staff/login");
    }, 5000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [navigate, session?.signedOut]);

  if (!session) return null;

  function signInAgain() {
    setSession(null);
    navigate("/staff/login");
  }

  return (
    <div
      className={`logout-animation${session.signedOut ? " is-signed-out" : ""}`}
      role="status"
      aria-live="polite"
      style={{
        "--logout-origin-x": `${session.origin.x}px`,
        "--logout-origin-y": `${session.origin.y}px`
      } as CSSProperties}
    >
      <svg className="logout-wave" width="100%" height="100%" aria-hidden="true">
        <defs>
          <pattern id="logout-seigaiha" width="48" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M-24 24a24 24 0 0 1 48 0M0 24a24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0"
              fill="none"
              stroke="white"
              strokeOpacity=".14"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#logout-seigaiha)" />
      </svg>
      <span className="logout-decoration" aria-hidden="true" />

      <section className={`logout-scene logout-signing${session.signedOut ? " is-exiting" : ""}`} aria-label="Signing out">
        <div className="logout-logo-badge" aria-hidden="true"><span /></div>
        <h1>Signing you out<span className="logout-ellipsis" aria-hidden="true">...</span></h1>
        <p>Saving your session and closing safely</p>
        <div className="logout-progress-track" aria-hidden="true">
          <span className="logout-progress-fill" />
          <svg className="logout-sushi-roll" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="22" fill="#fff" />
            <circle cx="26" cy="26" r="16" fill="#17191e" />
            <circle cx="26" cy="26" r="11" fill="#f3ece0" />
            <circle cx="22" cy="23" r="4" fill="#e0575c" />
            <circle cx="30" cy="29" r="4" fill="#68a66c" />
            <circle cx="30" cy="21" r="2.5" fill="#f4c55f" />
          </svg>
        </div>
        <span className="logout-progress-caption" aria-hidden="true">Closing your account session</span>
      </section>

      {session.signedOut && (
        <section className="logout-scene logout-success" aria-labelledby="logout-success-title">
          <div className="logout-confetti" aria-hidden="true">
            <i /><i /><i /><i /><i /><i />
          </div>
          <div className="logout-check-badge" aria-hidden="true">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="m15 27 7 7 15-16" />
            </svg>
          </div>
          <h1 id="logout-success-title">You&apos;re signed out</h1>
          <p>See you soon, {session.name}.</p>
          <button ref={signInButtonRef} type="button" className="logout-sign-in-button" onClick={signInAgain}>
            <LogIn aria-hidden="true" size={18} />
            Sign in again
          </button>
        </section>
      )}
    </div>
  );
}
