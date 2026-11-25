import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, Printer } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

type Props = {
  section?: string;
  showBack?: boolean;
  onPrintTestSlip?: () => void;
};

export default function PosHeader({ section, showBack = false, onPrintTestSlip }: Props) {
  const { user } = useAuth();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div className="flex items-center gap-3">
        {showBack && (
          <Link
            to="/staff/pos"
            aria-label="Back to Point of Sale"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Point of Sale</h1>
          {section && <p className="text-sm text-slate-600">{section}</p>}
        </div>
      </div>
      <nav aria-label="POS pages" className="flex items-center gap-2">
        <details className="pos-more-menu">
          <summary>
            More <ChevronDown aria-hidden="true" />
          </summary>
          <div className="pos-more-menu-panel">
            <Link to="/staff/pos/history">Transaction history</Link>
            {user?.role === "admin" && <Link to="/staff/pos/unlimited-settings">Unlimited settings</Link>}
            {onPrintTestSlip && (
              <button type="button" onClick={onPrintTestSlip}>
                <Printer aria-hidden="true" /> Print test slip
              </button>
            )}
          </div>
        </details>
      </nav>
    </header>
  );
}
