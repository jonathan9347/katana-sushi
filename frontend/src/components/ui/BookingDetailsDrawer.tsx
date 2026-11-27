import { useEffect, useRef } from "react";
import type React from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import "../../styles/staff-redesign.css";

export type BookingDetailsDrawerProps = {
  open: boolean;
  title: string;
  typeLabel: string;
  customerName: string;
  status: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
  helperText?: React.ReactNode;
  onClose: () => void;
};

export function BookingDetailsDrawer({
  open,
  title,
  typeLabel,
  customerName,
  status,
  body,
  actions,
  helperText,
  onClose
}: BookingDetailsDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="staff-reservation-drawer-backdrop fixed inset-0 z-50 flex justify-end bg-slate-950/40" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-drawer-title"
        tabIndex={-1}
        className="flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl outline-none motion-safe:animate-[booking-drawer-in_180ms_ease-out]"
      >
        <header className="staff-drawer-header relative overflow-hidden bg-[#1c1214] px-5 py-5 text-white">
          <div className="staff-drawer-decoration absolute -right-9 -top-12 h-[180px] w-[180px] rounded-full bg-[#a82e27]" aria-hidden="true" />
          <div className="staff-drawer-content relative flex items-start justify-between gap-3">
            <div>
              <p className="staff-drawer-eyebrow text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">{typeLabel}</p>
              <h2 id="booking-drawer-title" className="mt-1 text-xl font-black">{title}</h2>
              <p className="staff-drawer-customer mt-1 text-sm text-white/75">{customerName}</p>
            </div>
            <button type="button" aria-label="Close details" className="rounded-full bg-white/10 p-2 transition hover:rotate-90 hover:bg-white/20" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <span className="staff-drawer-status relative mt-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{status.replace(/_/g, " ")}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {body}
          {helperText ? (
            <div className="mt-4 rounded-[10px] border border-[#f0bbb7] bg-[#fbeceb] p-3 text-[13px] leading-5 text-[#7d1511]">
              {helperText}
            </div>
          ) : null}
        </div>
        <footer className="flex flex-wrap gap-2 border-t border-slate-200 bg-white p-4">
          <div className="flex flex-1 items-center gap-2">
            {actions ? actions : null}
          </div>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </footer>
      </aside>
    </div>
  );
}
