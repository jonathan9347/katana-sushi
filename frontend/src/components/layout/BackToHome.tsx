import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

type BackToHomeProps = {
  className?: string;
};

export default function BackToHome({ className = "" }: BackToHomeProps) {
  return (
    <Link
      to="/"
      aria-label="Back to home"
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-katana-border bg-katana-surface px-3 text-sm font-semibold text-[var(--customer-text)] transition hover:border-katana-red hover:text-katana-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-katana-red ${className}`}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span>Home</span>
    </Link>
  );
}
