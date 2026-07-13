import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export function useSessionTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const navigate = useNavigate();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const logout = () => {
      localStorage.removeItem("katana_token");
      localStorage.removeItem("katana_role");
      localStorage.removeItem("katana_user");
      navigate("/staff/login");
    };

    const resetTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        logout();
      }, timeoutMs);
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer));

    resetTimer();
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [navigate, timeoutMs]);
}
