import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

type Props = {
  section?: string;
  showBack?: boolean;
};

export default function PosHeader({ section, showBack = false }: Props) {
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
      <nav aria-label="POS pages" className="flex gap-2">
        <Link
          to="/staff/pos/history"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Transaction History
        </Link>
        <Link
          to="/staff/pos/unlimited-settings"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Unli Settings
        </Link>
      </nav>
    </header>
  );
}
