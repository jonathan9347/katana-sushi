import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, KeyRound } from "lucide-react";
import type { ToastKind } from "../../hooks/useToast";
import "./ToastViewport.css";

type ToastState = {
  id: number;
  message: string;
  kind: ToastKind;
};

export function ToastViewport() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    function onToast(event: Event) {
      const message = (event as CustomEvent<{ message: string; kind: ToastKind }>).detail;
      if (!message?.message) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      const id = ++nextId.current;
      setToast({ id, ...message });
      timer.current = window.setTimeout(() => setToast(null), 3000);
    }

    window.addEventListener("katana-toast", onToast);
    return () => {
      window.removeEventListener("katana-toast", onToast);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!toast) return null;
  const Icon = toast.kind === "error"
    ? AlertCircle
    : /password|reset/i.test(toast.message)
      ? KeyRound
      : Check;

  return (
    <div key={toast.id} className={`ui-toast${toast.kind === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
      <Icon aria-hidden="true" size={18} />
      <span>{toast.message}</span>
    </div>
  );
}
