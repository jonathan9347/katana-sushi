import { Link } from "react-router-dom";
import { DashboardWidget } from "./DashboardWidget";

export default function CashierDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3 lg:grid-cols-2">
        <DashboardWidget title="Today's Sales" icon="💰" value="₱8,450" subtitle="Sales processed today" />
        <DashboardWidget title="Today's Orders" icon="🧾" value={12} subtitle="Orders completed so far" />
        <DashboardWidget title="Average Order" icon="📊" value="₱704" subtitle="Average ticket value" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Quick POS Access" icon="💳" value="" subtitle="Start selling right away">
          <div className="grid gap-2">
            <Link className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-semibold text-white text-center" to="/staff/pos">
              Start New Sale
            </Link>
            <Link className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 text-center" to="/staff/pos/history">
              View History
            </Link>
            <Link className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 text-center" to="/staff/pos/unlimited-settings">
              Unlimited Session
            </Link>
          </div>
        </DashboardWidget>

        <DashboardWidget title="Recent Transactions" icon="🧾" value="" subtitle="Latest sales recorded">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• #KTN-001 ₱1,450 John</li>
            <li>• #KTN-002 ₱890 Maria</li>
            <li>• #KTN-003 ₱2,396 Pedro</li>
          </ul>
        </DashboardWidget>
      </div>
    </div>
  );
}
